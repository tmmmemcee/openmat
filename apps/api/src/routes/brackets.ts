import {
  RULESETS,
  type SchedulableBout,
  assignGroupsToMats,
  bracketScheduleBouts,
  bracketSizeFor,
  buildSchedule,
  drawBracket,
  estimateBoutMinutes,
  poolScheduleBouts,
  resolveBracket,
  roundRobin,
  type ScoredBracket,
  teamScores,
} from "@openmat/core";
import { and, asc, eq, inArray, isNotNull, ne, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../auth.js";
import type { Db } from "../db/client.js";
import { type BracketFormat, type BracketOptions, bouts, brackets, divisions, entries, groupMembers, groups } from "../db/schema.js";
import { HttpError } from "../errors.js";
import type { NotificationScheduler } from "../services/notify.js";
import { coreBracket, loadBracketViews } from "../services/tournament.js";
import { loadDivisions, loadEvent } from "./events.js";

type Event = Awaited<ReturnType<typeof loadEvent>>;
type Division = typeof divisions.$inferSelect;
type Entry = typeof entries.$inferSelect;

const generateInput = z.object({
  format: z.enum(["auto", "round-robin", "double-elim", "single-elim"]).default("auto"),
  /** With "auto": pools up to this size wrestle a round robin, bigger ones double elimination. */
  roundRobinUpTo: z.number().int().min(2).max(8).default(5),
  places: z.union([z.literal(4), z.literal(6), z.literal(8)]).default(6),
  trueSecond: z.boolean().default(false),
});

/** Seeded wrestlers first (by seed), then everyone else. */
function seededOrder(members: Entry[]): { seeds: string[]; rest: Entry[] } {
  const seeded = members.filter((m) => m.seed !== null).sort((a, b) => a.seed! - b.seed! || a.lastName.localeCompare(b.lastName));
  return { seeds: seeded.map((m) => m.id), rest: members.filter((m) => m.seed === null) };
}

function drawFor(members: Entry[], format: BracketFormat): { draw: (string | null)[]; size: number | null } {
  if (format === "round-robin") {
    const { seeds, rest } = seededOrder(members);
    return { draw: [...seeds, ...rest.sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0)).map((m) => m.id)], size: null };
  }
  const size = Math.max(format === "double-elim" ? 4 : 2, bracketSizeFor(members.length));
  const { seeds } = seededOrder(members);
  return { draw: drawBracket(members.map((m) => ({ id: m.id, team: m.team || undefined })), { seeds, size }), size };
}

function boutMinutes(event: Event, division: Division): number {
  const ruleset = RULESETS.find((r) => r.id === event.rulesetId);
  return estimateBoutMinutes(division.periodsSec, ruleset?.breakSec ?? 30);
}

/** Insert a bracket and all its bouts. */
async function createBracket(
  db: Db,
  event: Event,
  division: Division,
  spec: { name: string; groupId?: string; weightClass?: string; members: Entry[]; format: BracketFormat; options: BracketOptions; sortOrder: number },
): Promise<void> {
  const { draw, size } = drawFor(spec.members, spec.format);
  const [bracket] = await db
    .insert(brackets)
    .values({
      eventId: event.id,
      divisionId: division.id,
      groupId: spec.groupId ?? null,
      weightClass: spec.weightClass ?? null,
      name: spec.name,
      format: spec.format,
      options: spec.options,
      size,
      draw,
      sortOrder: spec.sortOrder,
    })
    .returning();
  const durationMin = boutMinutes(event, division);
  const core = coreBracket(bracket!);
  const rows = core
    ? core.bouts.map((b) => ({ key: b.id, round: b.round, entryA: null, entryB: null }))
    : roundRobin(draw.filter((x): x is string => !!x)).map((b) => ({ key: String(b.order), round: b.round, entryA: b.wrestler1, entryB: b.wrestler2 }));
  if (rows.length) {
    await db.insert(bouts).values(rows.map((r) => ({ ...r, eventId: event.id, bracketId: bracket!.id, durationMin })));
  }
}

async function anyBoutStarted(db: Db, eventId: string, bracketId?: string): Promise<boolean> {
  const started = await db
    .select({ id: bouts.id })
    .from(bouts)
    .where(
      and(
        eq(bouts.eventId, eventId),
        bracketId ? eq(bouts.bracketId, bracketId) : undefined,
        or(isNotNull(bouts.startedAt), isNotNull(bouts.winnerEntryId)),
      ),
    )
    .limit(1);
  return started.length > 0;
}

export function bracketRoutes(app: FastifyInstance, db: Db, scheduler: NotificationScheduler): void {
  /** Brackets and bouts, public. */
  app.get<{ Params: { slug: string } }>("/api/events/:slug/brackets", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    const views = await loadBracketViews(db, event.id);
    const ids = [...new Set(views.flatMap((b) => b.draw.filter((x): x is string => !!x)))];
    const wrestlers = ids.length
      ? await db
          .select({ id: entries.id, firstName: entries.firstName, lastName: entries.lastName, team: entries.team, seed: entries.seed, weight: entries.weight })
          .from(entries)
          .where(inArray(entries.id, ids))
      : [];
    return { brackets: views, wrestlers };
  });

  /** Team scores so far (advancement, bonus and placement points). Public. */
  app.get<{ Params: { slug: string } }>("/api/events/:slug/team-scores", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    const bs = await db.select().from(brackets).where(eq(brackets.eventId, event.id));
    const views = await loadBracketViews(db, event.id);
    const scored: ScoredBracket[] = views.map((v) => {
      const row = bs.find((b) => b.id === v.id)!;
      const core = coreBracket(row);
      // Where each bout's winner goes next, for "bye followed by a win".
      const winnerTo = new Map<string, string>();
      for (const b of core?.bouts ?? []) {
        for (const s of [b.top, b.bottom]) if (s.kind === "winner") winnerTo.set(s.bout, b.id);
      }
      return {
        bouts: v.bouts.map((b) => ({
          key: b.key,
          section: b.section,
          status: b.status,
          winner: b.status === "bye" ? ([b.a, b.b].find((x) => x && x !== "BYE") ?? null) : b.winnerEntryId,
          winType: b.result?.winType ?? null,
          winnerTo: winnerTo.get(b.key) ?? null,
        })),
        places: v.places,
      };
    });
    const people = await db.select({ id: entries.id, team: entries.team }).from(entries).where(eq(entries.eventId, event.id));
    const teamOf = new Map(people.map((p) => [p.id, p.team]));
    return teamScores(scored, (id) => teamOf.get(id) || undefined);
  });

  /** Make brackets for everyone: one per Madison group, or one per weight class. Replaces existing brackets. */
  app.post<{ Params: { slug: string } }>("/api/events/:slug/brackets/generate", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    const input = generateInput.parse(req.body ?? {});
    if (await anyBoutStarted(db, event.id)) {
      throw new HttpError(409, "Bouts have already been wrestled, so brackets can't be rebuilt. Redraw single brackets instead.");
    }
    const divs = await loadDivisions(db, event.id);
    const pickFormat = (n: number): BracketFormat =>
      input.format !== "auto" ? input.format : n <= input.roundRobinUpTo ? "round-robin" : "double-elim";
    const optionsFor = (format: BracketFormat): BracketOptions =>
      format === "double-elim" ? { places: input.places, trueSecond: input.trueSecond } : format === "single-elim" ? { thirdPlace: true } : {};
    const skipped: { name: string; reason: string }[] = [];
    let created = 0;

    await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      await tx.delete(brackets).where(eq(brackets.eventId, event.id));
      const people = await tx
        .select()
        .from(entries)
        .where(and(eq(entries.eventId, event.id), isNotNull(entries.weight), ne(entries.status, "scratched")));
      let sortOrder = 0;

      if (event.format === "madison") {
        const gs = await tx.select().from(groups).where(eq(groups.eventId, event.id)).orderBy(asc(groups.number));
        const members = gs.length ? await tx.select().from(groupMembers).where(inArray(groupMembers.groupId, gs.map((g) => g.id))) : [];
        for (const d of divs) {
          for (const g of gs.filter((x) => x.divisionId === d.id)) {
            const name = `${d.name} · Group ${g.number}`;
            const ids = new Set(members.filter((m) => m.groupId === g.id).map((m) => m.entryId));
            const list = people.filter((p) => ids.has(p.id));
            if (list.length < 2) {
              skipped.push({ name, reason: list.length ? "Only one wrestler, so no matches" : "Empty group" });
              continue;
            }
            const format = pickFormat(list.length);
            await createBracket(txDb, event, d, { name, groupId: g.id, members: list, format, options: optionsFor(format), sortOrder: sortOrder++ });
            created++;
          }
        }
        if (!gs.length) throw new HttpError(400, "Make the groups first (Groups tab), then the brackets.");
      } else {
        for (const d of divs) {
          for (const w of d.weightClasses ?? []) {
            const name = `${d.name} · ${w}`;
            const list = people.filter((p) => p.divisionId === d.id && p.weightClass === String(w));
            if (list.length < 2) {
              if (list.length === 1) skipped.push({ name, reason: "Only one wrestler, so no matches" });
              continue;
            }
            const format = pickFormat(list.length);
            await createBracket(txDb, event, d, { name, weightClass: String(w), members: list, format, options: optionsFor(format), sortOrder: sortOrder++ });
            created++;
          }
        }
      }
    });
    return { created, skipped };
  });

  /**
   * Redraw one elimination bracket with current seeds (e.g. after seeding
   * changes). Its bouts, mats and numbers stay; only who is on which line
   * changes. Not allowed once it has results.
   */
  app.post<{ Params: { slug: string; id: string } }>("/api/events/:slug/brackets/:id/redraw", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    const [bracket] = await db.select().from(brackets).where(and(eq(brackets.id, req.params.id), eq(brackets.eventId, event.id)));
    if (!bracket) throw new HttpError(404, "Bracket not found.");
    if (bracket.format === "round-robin") throw new HttpError(400, "In a round robin everyone wrestles everyone, so seeds don't change it.");
    if (await anyBoutStarted(db, event.id, bracket.id)) throw new HttpError(409, "This bracket already has results, so it can't be redrawn.");
    const ids = bracket.draw.filter((x): x is string => !!x);
    const members = await db.select().from(entries).where(inArray(entries.id, ids));
    const { draw } = drawFor(members, bracket.format);
    await db.update(brackets).set({ draw }).where(eq(brackets.id, bracket.id));
    return { ok: true };
  });

  /** Assign every bout a mat, order and number, respecting rest. Only before any bout has started. */
  app.post<{ Params: { slug: string } }>("/api/events/:slug/brackets/schedule", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    const input = z
      .object({
        keepGroupsTogether: z.boolean().optional(),
        numbering: z.enum(["per-mat", "sequential"]).default("per-mat"),
      })
      .parse(req.body ?? {});
    if (await anyBoutStarted(db, event.id)) {
      throw new HttpError(409, "Bouts have started, so the whole schedule can't be rebuilt. Move bouts between mats instead.");
    }
    const bs = await db.select().from(brackets).where(eq(brackets.eventId, event.id)).orderBy(asc(brackets.sortOrder));
    if (!bs.length) throw new HttpError(400, "Make the brackets first.");
    const rows = await db.select().from(bouts).where(eq(bouts.eventId, event.id));
    const byBracket = Map.groupBy(rows, (r) => r.bracketId);
    const mats = Array.from({ length: event.settings.mats }, (_, i) => String(i + 1));
    const rest = event.settings.restMin;
    const keepTogether = input.keepGroupsTogether ?? event.format === "madison";

    const matFor = keepTogether
      ? assignGroupsToMats(
          bs.map((b) => {
            const list = byBracket.get(b.id) ?? [];
            return { id: b.id, minutes: list.reduce((sum, r) => sum + r.durationMin, 0) };
          }),
          mats,
        )
      : null;

    const sched: SchedulableBout[] = [];
    const idOf = new Map<string, string>(); // "bracketId:key" -> bout id
    for (const b of bs) {
      const list = byBracket.get(b.id) ?? [];
      for (const r of list) idOf.set(`${b.id}:${r.key}`, r.id);
      const timing = {
        durationMin: list[0]?.durationMin ?? 6,
        restMin: rest,
        priorityOffset: b.sortOrder,
        ...(matFor ? { mats: [matFor.get(b.id)!] } : {}),
      };
      const core = coreBracket(b);
      if (core) {
        const results: Record<string, { winner: string }> = {};
        sched.push(...bracketScheduleBouts(`${b.id}:`, core, resolveBracket(core, b.draw, results), timing));
      } else {
        const pool = [...list]
          .sort((x, y) => Number(x.key) - Number(y.key))
          .map((r) => ({ round: r.round, order: Number(r.key), wrestler1: r.entryA!, wrestler2: r.entryB! }));
        sched.push(...poolScheduleBouts(`${b.id}:`, pool, timing));
      }
    }

    const { schedule, unscheduled } = buildSchedule(sched, mats, { numbering: input.numbering });
    const afterOf = new Map(sched.map((s) => [s.id, s.after]));
    const perMatOrder = new Map<string, number>();
    await db.transaction(async (tx) => {
      await tx.update(bouts).set({ mat: null, matOrder: null, boutNumber: null, plannedStartMin: null, after: [] }).where(eq(bouts.eventId, event.id));
      for (const s of [...schedule].sort((a, b) => a.start - b.start)) {
        const order = (perMatOrder.get(s.matId) ?? 0) + 1;
        perMatOrder.set(s.matId, order);
        await tx
          .update(bouts)
          .set({
            mat: Number(s.matId),
            matOrder: order,
            boutNumber: s.boutNumber,
            plannedStartMin: Math.round(s.start),
            after: (afterOf.get(s.boutId) ?? []).map((a) => ({ boutId: idOf.get(a.boutId)!, restMin: a.restMin })),
          })
          .where(eq(bouts.id, idOf.get(s.boutId)!));
      }
    });
    scheduler.poke(event.id);
    const lastEnd = Math.max(0, ...schedule.map((s) => s.end));
    return { scheduled: schedule.length, unscheduled: unscheduled.length, estimatedMinutes: Math.round(lastEnd) };
  });
}
