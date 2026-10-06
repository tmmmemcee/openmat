/**
 * Youth scratch duals and tri-meets: the director pairs kids across teams
 * (automatically, then adjusts by hand). The matches live in one "pairings"
 * bracket, so scheduling, table scoring, the mat board and alerts work as
 * for any other event.
 */
import { DEFAULT_MEET_OPTIONS, type MeetOptions, type MeetWrestler, checkPair, pairMeet } from "@openmat/core";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../auth.js";
import type { Db } from "../db/client.js";
import { bouts, brackets, entries, wrestlers } from "../db/schema.js";
import { HttpError } from "../errors.js";
import { boutMinutes } from "./brackets.js";
import { DEFAULT_MEET_SETTINGS, loadDivisions, loadEvent } from "./events.js";

type Event = Awaited<ReturnType<typeof loadEvent>>;

const meetOptions = (event: Event): MeetOptions => ({ ...DEFAULT_MEET_OPTIONS, ...DEFAULT_MEET_SETTINGS, ...event.settings.meet });

/** Everyone in the meet (not scratched), with what pairing needs to know. */
async function meetPeople(db: Db, event: Event) {
  const divs = await loadDivisions(db, event.id);
  const genderOf = new Map(divs.map((d) => [d.id, d.gender]));
  const year = Number(event.startDate.slice(0, 4));
  const rows = await db
    .select({ entry: entries, rating: wrestlers.rating, level: wrestlers.level })
    .from(entries)
    .leftJoin(wrestlers, eq(wrestlers.id, entries.wrestlerId))
    .where(and(eq(entries.eventId, event.id), ne(entries.status, "scratched")));
  return rows.map(({ entry: e, rating, level }) => {
    const gender = genderOf.get(e.divisionId);
    // A weigh-in wins; otherwise the latest weight the coach gave us.
    const weight = e.weight ?? e.declaredWeight;
    return {
      id: e.id,
      name: `${e.firstName} ${e.lastName}`,
      team: e.team,
      weight,
      weightSource: e.weight != null ? ("weigh-in" as const) : e.declaredWeight != null ? ("coach" as const) : null,
      age: e.birthYear ? year - e.birthYear : null,
      gender: gender === "boys" || gender === "girls" ? gender : null,
      level,
      rating: rating != null ? Math.round(rating) : null,
    };
  });
}

type Person = Awaited<ReturnType<typeof meetPeople>>[number];

const toMeetWrestler = (p: Person): MeetWrestler => ({
  id: p.id,
  team: p.team,
  weight: p.weight!,
  age: p.age,
  gender: p.gender,
  ...(p.rating != null ? { skill: p.rating } : {}),
});

async function pairingsBracket(db: Db, event: Event) {
  const [existing] = await db.select().from(brackets).where(and(eq(brackets.eventId, event.id), eq(brackets.format, "pairings")));
  if (existing) return existing;
  const divs = await loadDivisions(db, event.id);
  const [created] = await db
    .insert(brackets)
    .values({ eventId: event.id, divisionId: divs[0]!.id, name: "Meet matches", format: "pairings", draw: [] })
    .returning();
  return created!;
}

/** Keep the bracket's wrestler list current, so public pages can name everyone. */
async function syncDraw(db: Db, bracketId: string) {
  const rows = await db.select({ a: bouts.entryA, b: bouts.entryB }).from(bouts).where(eq(bouts.bracketId, bracketId));
  const ids = [...new Set(rows.flatMap((r) => [r.a, r.b]).filter((x): x is string => !!x))];
  await db.update(brackets).set({ draw: ids }).where(eq(brackets.id, bracketId));
}

async function pairingRows(db: Db, event: Event) {
  const [bracket] = await db.select().from(brackets).where(and(eq(brackets.eventId, event.id), eq(brackets.format, "pairings")));
  if (!bracket) return { bracket: null, rows: [] };
  const rows = await db.select().from(bouts).where(eq(bouts.bracketId, bracket.id));
  return { bracket, rows: rows.sort((x, y) => x.round - y.round || Number(x.key) - Number(y.key)) };
}

const notStarted = (r: typeof bouts.$inferSelect) => !r.startedAt && !r.winnerEntryId;

export function meetRoutes(app: FastifyInstance, db: Db): void {
  /** The director's pairing board: every match with its flags, and who's still short of matches (and why). */
  app.get<{ Params: { slug: string } }>("/api/events/:slug/pairings", async (req, reply) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    if (event.format !== "meet") throw new HttpError(400, "Pairings are for meets.");
    reply.header("cache-control", "private, no-store");
    const opts = meetOptions(event);
    const people = await meetPeople(db, event);
    const byId = new Map(people.map((p) => [p.id, p]));
    const { rows } = await pairingRows(db, event);
    const count = new Map<string, number>();
    for (const r of rows) for (const id of [r.entryA, r.entryB]) if (id) count.set(id, (count.get(id) ?? 0) + 1);

    const weighed = people.filter((p) => p.weight != null);
    const existing = rows.filter((r) => r.entryA && r.entryB).map((r) => [r.entryA!, r.entryB!] as [string, string]);
    const preview = pairMeet(weighed.map(toMeetWrestler), opts, existing);
    const canAdd = new Set(preview.pairings.flatMap((p) => [p.a, p.b]));
    const reasonFor = new Map(preview.short.map((s) => [s.id, s.reason]));

    return {
      options: opts,
      pairings: rows.map((r) => {
        const a = r.entryA ? byId.get(r.entryA) : undefined;
        const b = r.entryB ? byId.get(r.entryB) : undefined;
        const check = a?.weight != null && b?.weight != null ? checkPair(toMeetWrestler(a), toMeetWrestler(b), opts) : null;
        return {
          boutId: r.id,
          round: r.round,
          a: r.entryA,
          b: r.entryB,
          status: r.winnerEntryId ? "done" : r.startedAt ? "wrestling" : "ready",
          mat: r.mat,
          boutNumber: r.boutNumber,
          ...(check ? { weightPct: check.weightPct, ageGap: check.ageGap, flags: check.ok ? check.flags : [check.reason!, ...check.flags] } : { flags: [] }),
        };
      }),
      wrestlers: people.map((p) => ({ ...p, matches: count.get(p.id) ?? 0 })),
      short: people
        .filter((p) => (count.get(p.id) ?? 0) < opts.matchesPerKid)
        .map((p) => ({
          entryId: p.id,
          matches: count.get(p.id) ?? 0,
          reason:
            p.weight == null
              ? "Needs a weight (ask the coach, or weigh in)"
              : canAdd.has(p.id)
                ? "Can be paired: use Auto-pair"
                : (reasonFor.get(p.id) ?? "Everyone close enough already has their matches"),
        })),
    };
  });

  /**
   * Pair everyone automatically. Matches already wrestled (or started) always
   * stay; other existing matches stay too unless `replace` is set.
   */
  app.post<{ Params: { slug: string } }>("/api/events/:slug/pairings/auto", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    if (event.format !== "meet") throw new HttpError(400, "Pairings are for meets.");
    const { replace } = z.object({ replace: z.boolean().default(false) }).parse(req.body ?? {});
    const opts = meetOptions(event);
    const people = (await meetPeople(db, event)).filter((p) => p.weight != null);
    const divs = await loadDivisions(db, event.id);

    return db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      const bracket = await pairingsBracket(txDb, event);
      let rows = await tx.select().from(bouts).where(eq(bouts.bracketId, bracket.id));
      if (replace) {
        const drop = rows.filter(notStarted);
        for (const r of drop) await tx.delete(bouts).where(eq(bouts.id, r.id));
        rows = rows.filter((r) => !notStarted(r));
      }
      const existing = rows.filter((r) => r.entryA && r.entryB).map((r) => [r.entryA!, r.entryB!] as [string, string]);
      const { pairings, short } = pairMeet(people.map(toMeetWrestler), opts, existing);
      let key = Math.max(0, ...rows.map((r) => Number(r.key)));
      const durationMin = boutMinutes(event, divs[0]!);
      if (pairings.length) {
        await tx.insert(bouts).values(
          pairings.map((p) => ({ eventId: event.id, bracketId: bracket.id, key: String(++key), round: p.round, entryA: p.a, entryB: p.b, durationMin })),
        );
      }
      await syncDraw(txDb, bracket.id);
      return { added: pairings.length, short: short.length };
    });
  });

  /** Pair two kids by hand. Outside the limits (or teammates) needs `force`. */
  app.post<{ Params: { slug: string } }>("/api/events/:slug/pairings", async (req, reply) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    if (event.format !== "meet") throw new HttpError(400, "Pairings are for meets.");
    const input = z.object({ a: z.string().uuid(), b: z.string().uuid(), force: z.boolean().default(false) }).parse(req.body);
    if (input.a === input.b) throw new HttpError(400, "Pick two different wrestlers.");
    const people = new Map((await meetPeople(db, event)).map((p) => [p.id, p]));
    const a = people.get(input.a);
    const b = people.get(input.b);
    if (!a || !b) throw new HttpError(404, "Wrestler not found (or scratched).");
    if (a.weight != null && b.weight != null) {
      const check = checkPair(toMeetWrestler(a), toMeetWrestler(b), meetOptions(event));
      if (!check.ok && !input.force) throw new HttpError(409, `${check.reason}. Pair them anyway?`);
    }
    const divs = await loadDivisions(db, event.id);
    const bout = await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      const bracket = await pairingsBracket(txDb, event);
      const rows = await tx.select().from(bouts).where(eq(bouts.bracketId, bracket.id));
      if (rows.some((r) => (r.entryA === a.id && r.entryB === b.id) || (r.entryA === b.id && r.entryB === a.id))) {
        throw new HttpError(409, `${a.name} and ${b.name} are already paired.`);
      }
      const matchesOf = (id: string) => rows.filter((r) => r.entryA === id || r.entryB === id).length;
      const [row] = await tx
        .insert(bouts)
        .values({
          eventId: event.id,
          bracketId: bracket.id,
          key: String(Math.max(0, ...rows.map((r) => Number(r.key))) + 1),
          round: Math.max(matchesOf(a.id), matchesOf(b.id)) + 1,
          entryA: a.id,
          entryB: b.id,
          durationMin: boutMinutes(event, divs[0]!),
        })
        .returning();
      await syncDraw(txDb, bracket.id);
      return row!;
    });
    return reply.status(201).send({ boutId: bout.id });
  });

  /** Take a match out (only before it's wrestled). */
  app.delete<{ Params: { slug: string; boutId: string } }>("/api/events/:slug/pairings/:boutId", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    const { bracket, rows } = await pairingRows(db, event);
    const row = rows.find((r) => r.id === req.params.boutId);
    if (!bracket || !row) throw new HttpError(404, "Match not found.");
    if (!notStarted(row)) throw new HttpError(409, "This match has already started. Reset it on the Live tab first.");
    await db.delete(bouts).where(and(eq(bouts.id, row.id), isNull(bouts.startedAt)));
    await syncDraw(db, bracket.id);
    return { ok: true };
  });
}
