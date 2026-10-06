/**
 * Teams and their saved rosters. A team has a private coach link (no
 * accounts). Coaches keep wrestlers' recent weights, experience level and
 * notes here, and register them into events in one go. Level and rating are
 * private to the coach (and directors of events the wrestler is entered in).
 */
import { seedRating } from "@openmat/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { hashToken, newToken } from "../auth.js";
import { PUBLIC_BASE_URL } from "../config.js";
import type { Db } from "../db/client.js";
import { entries, teams, wrestlers } from "../db/schema.js";
import { HttpError } from "../errors.js";
import type { Mailer } from "../mailer.js";
import { RateLimiter } from "../rateLimit.js";
import { type EntryInput, findDuplicate, newEntryValues, resolveDivision } from "./entries.js";
import { loadDivisions, loadEvent } from "./events.js";

const level = z.enum(["novice", "intermediate", "advanced"]);
const wrestlerInput = z.object({
  firstName: z.string().trim().min(1, "Required").max(60),
  lastName: z.string().trim().min(1, "Required").max(60),
  birthYear: z.number().int().min(1950).max(2100).nullish(),
  gender: z.enum(["boys", "girls"]).nullish(),
  weight: z.number().min(20).max(500).nullish(),
  level: level.nullish(),
  yearsWrestled: z.number().int().min(0).max(30).nullish(),
  notes: z.string().trim().max(500).optional(),
});

export const coachUrl = (teamId: string, token: string) => `${PUBLIC_BASE_URL}/t/${teamId}#k=${token}`;

async function requireTeam(db: Db, req: FastifyRequest, teamId: string) {
  const id = z.string().uuid().safeParse(teamId);
  if (!id.success) throw new HttpError(404, "Team not found.");
  const header = req.headers.authorization;
  const [team] = await db.select().from(teams).where(eq(teams.id, id.data));
  if (!team) throw new HttpError(404, "Team not found.");
  if (!header?.startsWith("Bearer ") || hashToken(header.slice(7)) !== team.tokenHash) {
    throw new HttpError(401, "This needs the team's coach link.");
  }
  return team;
}

const presentWrestler = (w: typeof wrestlers.$inferSelect) => ({ ...w, rating: Math.round(w.rating) });

export function teamRoutes(app: FastifyInstance, db: Db, mailer: Mailer): void {
  const limiter = new RateLimiter(10, 60 * 60 * 1000);

  /** Create a team. Returns the coach link token once (and emails it if an address is given). */
  app.post("/api/teams", async (req, reply) => {
    if (!limiter.allow(req.ip)) throw new HttpError(429, "Too many new teams from here. Please try again later.");
    const input = z
      .object({
        name: z.string().trim().min(2, "Enter the team or club name").max(80),
        coachEmail: z.string().trim().toLowerCase().email("That email doesn't look right").max(200).nullish().or(z.literal("").transform(() => null)),
      })
      .parse(req.body);
    const token = newToken();
    const [team] = await db.insert(teams).values({ name: input.name, coachEmail: input.coachEmail ?? null, tokenHash: hashToken(token) }).returning();
    if (team!.coachEmail) {
      await mailer
        .send({
          to: team!.coachEmail,
          subject: `Your OpenMat coach link: ${team!.name}`,
          text: `Here is the coach link for ${team!.name}. Use it to keep your roster and register your wrestlers.\n\n${coachUrl(team!.id, token)}\n\nAnyone with this link can manage your roster, so keep it private.`,
        })
        .catch((err) => req.log.error(err, "coach email failed"));
    }
    return reply.status(201).send({ id: team!.id, name: team!.name, coachToken: token });
  });

  app.get<{ Params: { teamId: string } }>("/api/teams/:teamId", async (req, reply) => {
    const team = await requireTeam(db, req, req.params.teamId);
    reply.header("cache-control", "private, no-store");
    const roster = await db
      .select()
      .from(wrestlers)
      .where(and(eq(wrestlers.teamId, team.id), isNull(wrestlers.archivedAt)))
      .orderBy(asc(wrestlers.lastName), asc(wrestlers.firstName));
    return { id: team.id, name: team.name, coachEmail: team.coachEmail, wrestlers: roster.map(presentWrestler) };
  });

  app.patch<{ Params: { teamId: string } }>("/api/teams/:teamId", async (req) => {
    const team = await requireTeam(db, req, req.params.teamId);
    const input = z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        coachEmail: z.string().trim().toLowerCase().email().max(200).nullish().or(z.literal("").transform(() => null)),
      })
      .parse(req.body);
    await db.update(teams).set(input).where(eq(teams.id, team.id));
    return { ok: true };
  });

  app.post<{ Params: { teamId: string } }>("/api/teams/:teamId/wrestlers", async (req, reply) => {
    const team = await requireTeam(db, req, req.params.teamId);
    const input = wrestlerInput.parse(req.body);
    const [w] = await db
      .insert(wrestlers)
      .values({
        teamId: team.id,
        firstName: input.firstName,
        lastName: input.lastName,
        birthYear: input.birthYear ?? null,
        gender: input.gender ?? null,
        weight: input.weight ?? null,
        weightUpdatedAt: input.weight != null ? new Date() : null,
        level: input.level ?? null,
        yearsWrestled: input.yearsWrestled ?? null,
        rating: seedRating(input.level),
        notes: input.notes ?? "",
      })
      .returning();
    return reply.status(201).send(presentWrestler(w!));
  });

  /** Paste a roster from a spreadsheet: good rows are added, bad rows come back with the reason. */
  app.post<{ Params: { teamId: string } }>("/api/teams/:teamId/wrestlers/import", async (req) => {
    const team = await requireTeam(db, req, req.params.teamId);
    const { rows } = z.object({ rows: z.array(z.unknown()).min(1).max(300) }).parse(req.body);
    const errors: { row: number; message: string }[] = [];
    let created = 0;
    for (const [i, raw] of rows.entries()) {
      const parsed = wrestlerInput.safeParse(raw);
      if (!parsed.success) {
        errors.push({ row: i + 1, message: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
        continue;
      }
      const w = parsed.data;
      await db.insert(wrestlers).values({
        teamId: team.id,
        firstName: w.firstName,
        lastName: w.lastName,
        birthYear: w.birthYear ?? null,
        gender: w.gender ?? null,
        weight: w.weight ?? null,
        weightUpdatedAt: w.weight != null ? new Date() : null,
        level: w.level ?? null,
        yearsWrestled: w.yearsWrestled ?? null,
        rating: seedRating(w.level),
        notes: w.notes ?? "",
      });
      created++;
    }
    return { created, errors };
  });

  app.patch<{ Params: { teamId: string; wrestlerId: string } }>("/api/teams/:teamId/wrestlers/:wrestlerId", async (req) => {
    const team = await requireTeam(db, req, req.params.teamId);
    const patch = wrestlerInput.partial().parse(req.body);
    const [w] = await db.select().from(wrestlers).where(and(eq(wrestlers.id, req.params.wrestlerId), eq(wrestlers.teamId, team.id)));
    if (!w) throw new HttpError(404, "Wrestler not found.");
    const update: Partial<typeof wrestlers.$inferInsert> = { ...patch };
    if (patch.weight !== undefined) update.weightUpdatedAt = patch.weight === null ? null : new Date();
    // The level only sets the starting point; once results exist, they drive the rating.
    if (patch.level !== undefined && w.ratedMatches === 0) update.rating = seedRating(patch.level);
    const [updated] = await db.update(wrestlers).set(update).where(eq(wrestlers.id, w.id)).returning();
    return presentWrestler(updated!);
  });

  /** Remove from the roster. Kept (archived) so past results and ratings stay intact. */
  app.delete<{ Params: { teamId: string; wrestlerId: string } }>("/api/teams/:teamId/wrestlers/:wrestlerId", async (req) => {
    const team = await requireTeam(db, req, req.params.teamId);
    const done = await db
      .update(wrestlers)
      .set({ archivedAt: new Date() })
      .where(and(eq(wrestlers.id, req.params.wrestlerId), eq(wrestlers.teamId, team.id)))
      .returning({ id: wrestlers.id });
    if (!done.length) throw new HttpError(404, "Wrestler not found.");
    return { ok: true };
  });

  /** Register saved wrestlers into an event (while its registration is open). */
  app.post<{ Params: { teamId: string } }>("/api/teams/:teamId/register", async (req) => {
    const team = await requireTeam(db, req, req.params.teamId);
    const input = z
      .object({
        eventSlug: z.string().trim().min(1).max(40),
        wrestlers: z
          .array(z.object({ wrestlerId: z.string().uuid(), weightClass: z.string().trim().max(10).nullish(), divisionId: z.string().uuid().nullish() }))
          .min(1)
          .max(150),
      })
      .parse(req.body);
    const event = await loadEvent(db, input.eventSlug);
    if (!event.settings.registrationOpen) throw new HttpError(403, "Registration for this event is closed.");
    const divs = await loadDivisions(db, event.id);
    const roster = new Map(
      (await db.select().from(wrestlers).where(and(eq(wrestlers.teamId, team.id), isNull(wrestlers.archivedAt)))).map((w) => [w.id, w]),
    );
    const already = new Set(
      (await db.select({ wrestlerId: entries.wrestlerId }).from(entries).where(eq(entries.eventId, event.id))).map((e) => e.wrestlerId),
    );
    const errors: { wrestlerId: string; name: string; message: string }[] = [];
    let created = 0;
    for (const pick of input.wrestlers) {
      const w = roster.get(pick.wrestlerId);
      if (!w) {
        errors.push({ wrestlerId: pick.wrestlerId, name: "?", message: "Not on this team's roster." });
        continue;
      }
      const name = `${w.firstName} ${w.lastName}`;
      try {
        const entry: EntryInput = {
          firstName: w.firstName,
          lastName: w.lastName,
          team: team.name,
          birthYear: w.birthYear,
          gender: w.gender,
          divisionId: pick.divisionId ?? null,
          declaredWeight: w.weight,
          weightClass: pick.weightClass ?? null,
          contactEmail: null,
        };
        if (already.has(w.id) || (await findDuplicate(db, event.id, entry))) throw new HttpError(409, "Already entered.");
        const division = resolveDivision(event, divs, entry);
        await db.insert(entries).values({ ...newEntryValues(event, division, entry), wrestlerId: w.id });
        already.add(w.id);
        created++;
      } catch (err) {
        errors.push({ wrestlerId: w.id, name, message: (err as Error).message });
      }
    }
    return { created, errors };
  });
}
