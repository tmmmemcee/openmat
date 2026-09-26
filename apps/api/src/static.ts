import fastifyStatic from "@fastify/static";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { resolve } from "node:path";
import type { Db } from "./db/client.js";
import { entries } from "./db/schema.js";

/**
 * Serve the built web app (apps/web/dist) for single-box hosting: hashed
 * assets are cached for a year, and every other non-API path gets index.html
 * so the app's own routes work on reload.
 */
export async function serveWebApp(app: FastifyInstance, dir: string): Promise<void> {
  const root = resolve(dir);
  await app.register(fastifyStatic, {
    root,
    wildcard: false,
    setHeaders: (res, path) => {
      res.header("cache-control", path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found." });
    if (req.url.startsWith("/uploads/")) return reply.code(404).send({ error: "Not found." });
    return reply.header("cache-control", "no-cache").sendFile("index.html", root);
  });
}

/**
 * Serve the uploads directory (wrestler photos, eventually event logos) at /uploads/.
 * Files are immutable per-entry, so cache them for a day. Safe to register
 * alongside serveWebApp — different prefixes don't collide.
 *
 * Wrestler photos are consent-gated at serve time, not just in the UI: the
 * flag lives on the entry, and a photo whose entry hasn't consented is
 * answered as a plain 404 (rather than 403) so the endpoint doesn't reveal
 * which entries have photos at all.
 */
export async function serveUploads(app: FastifyInstance, db: Db, dir: string): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    if (req.method !== "GET" && req.method !== "HEAD") return;
    const url = (req.url ?? "").split("?")[0]!;
    if (!url.startsWith("/uploads/entries/")) return;
    const entryId = url.slice("/uploads/entries/".length).split(".")[0];
    if (!entryId) return reply.code(404).send({ error: "Not found." });
    const [entry] = await db
      .select({ photoConsent: entries.photoConsent })
      .from(entries)
      .where(eq(entries.id, entryId));
    if (!entry?.photoConsent) return reply.code(404).send({ error: "Not found." });
  });

  await app.register(fastifyStatic, {
    root: resolve(dir),
    prefix: "/uploads/",
    decorateReply: false,
    setHeaders: (res) => {
      res.header("cache-control", "public, max-age=86400");
    },
  });
}
