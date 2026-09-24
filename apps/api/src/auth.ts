/**
 * Access without accounts: each event has secret links (director, weigh-in,
 * one per mat for tables). The token travels as `Authorization: Bearer <token>`;
 * lookups use its SHA-256 hash, and the director's token itself is never stored.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Db } from "./db/client.js";
import { accessLinks, type StaffRole } from "./db/schema.js";
import { HttpError } from "./errors.js";

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createAccessLink(db: Db, eventId: string, role: StaffRole, mat?: number): Promise<string> {
  const token = newToken();
  await db.insert(accessLinks).values({
    eventId,
    role,
    mat: mat ?? null,
    tokenHash: hashToken(token),
    token: role === "director" ? null : token,
  });
  return token;
}

export interface Access {
  role: StaffRole;
  mat: number | null;
}

/** The caller's access to this event, or null for the public. */
export async function accessFor(db: Db, req: FastifyRequest, eventId: string): Promise<Access | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const [link] = await db
    .select({ role: accessLinks.role, mat: accessLinks.mat })
    .from(accessLinks)
    .where(and(eq(accessLinks.tokenHash, hashToken(header.slice(7))), eq(accessLinks.eventId, eventId), isNull(accessLinks.revokedAt)));
  return link ?? null;
}

/** Throws 401/403 unless the caller has one of the roles. Directors can do everything. */
export async function requireRole(db: Db, req: FastifyRequest, eventId: string, ...roles: StaffRole[]): Promise<Access> {
  const access = await accessFor(db, req, eventId);
  if (!access) throw new HttpError(401, "This needs a staff link for this event.");
  if (access.role !== "director" && !roles.includes(access.role)) {
    throw new HttpError(403, "Your link doesn't allow this. Ask the tournament director.");
  }
  return access;
}
