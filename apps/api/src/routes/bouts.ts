import { RULESETS, type WinType, boutState, finalizeBout, manualOutcome } from "@openmat/core";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type Access, accessFor, requireRole } from "../auth.js";
import type { Db } from "../db/client.js";
import { boutEvents, bouts, entries } from "../db/schema.js";
import { HttpError } from "../errors.js";
import { publicCache } from "../httpCache.js";
import type { NotificationScheduler } from "../services/notify.js";
import { bumpVersion, liveDetails, memo, queues, snapshot } from "../services/snapshot.js";
import { type BoutView, BYE, loadBoutEvents, loadBracketViews, toEngineEvents } from "../services/tournament.js";
import { loadDivisions, loadEvent } from "./events.js";

type Event = Awaited<ReturnType<typeof loadEvent>>;

const corner = z.enum(["A", "B"]);
const eventMeta = {
  id: z.string().min(8).max(64).regex(/^[\w-]+$/),
  period: z.number().int().min(1).max(20).optional(),
  matchTimeSec: z.number().min(0).max(3600).optional(),
  at: z.string().max(40).optional(),
  reason: z.string().max(200).optional(),
};
const boutEventInput = z.discriminatedUnion("type", [
  z.object({ ...eventMeta, type: z.literal("score"), corner, action: z.string().max(10) }),
  z.object({ ...eventMeta, type: z.literal("penalty"), corner, kind: z.string().max(30), points: z.number().int().min(0).max(5).optional() }),
  z.object({ ...eventMeta, type: z.literal("riding-time"), corner, seconds: z.number().min(0).max(3600) }),
  z.object({
    ...eventMeta,
    type: z.literal("position"),
    position: z.enum(["neutral", "A-top", "B-top"]),
    chooser: corner.optional(),
    choice: z.enum(["top", "bottom", "neutral", "defer"]).optional(),
  }),
  z.object({ ...eventMeta, type: z.literal("void"), target: z.string().max(64) }),
]);

const endingInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("time") }),
  z.object({ type: z.literal("tech-fall") }),
  z.object({ type: z.enum(["fall", "injury-default", "disqualification", "forfeit", "medical-forfeit"]), winner: corner, matchTimeSec: z.number().min(0).max(3600).optional() }),
]);

const finishInput = z.union([
  z.object({ mode: z.literal("live"), ending: endingInput }),
  z.object({
    mode: z.literal("manual"),
    winner: corner,
    winType: z.string().max(10),
    score: z.object({ A: z.number().int().min(0).max(99), B: z.number().int().min(0).max(99) }).optional(),
    matchTimeSec: z.number().min(0).max(3600).optional(),
  }),
]);

async function findBout(db: Db, event: Event, boutId: string): Promise<{ view: BoutView; bracketName: string }> {
  const { views } = await snapshot(db, event);
  for (const b of views) {
    const view = b.bouts.find((x) => x.id === boutId);
    if (view) return { view, bracketName: b.name };
  }
  throw new HttpError(404, "Bout not found.");
}

/** Tables can only work their own mat. */
function checkMat(access: Access, view: BoutView): void {
  if (access.role === "table" && view.mat !== access.mat) {
    throw new HttpError(403, `That bout is on mat ${view.mat ?? "(none)"}, not your mat ${access.mat}.`);
  }
}

function rulesetFor(event: Event) {
  const r = RULESETS.find((x) => x.id === event.rulesetId);
  if (!r) throw new HttpError(500, "This event's rule set is missing.");
  return r;
}

const byOf = (access: Access) => (access.role === "table" ? `table:${access.mat}` : access.role);

export function boutRoutes(app: FastifyInstance, db: Db, scheduler: NotificationScheduler): void {
  // Anything that changes who's on a mat may make alerts due.
  // (Queued before the response goes out, so the next request already sees it pending.)
  app.addHook("onSend", async (req, reply, payload) => {
    const slug = (req.params as { slug?: string } | undefined)?.slug;
    if (slug && req.method !== "GET" && reply.statusCode < 400 && req.url.includes("/bouts/") && !req.routeOptions.config.live) {
      const event = await loadEvent(db, slug).catch(() => null);
      if (event) scheduler.poke(event.id);
    }
    return payload;
  });

  /** Everything a mat needs: its line (with live details for the bout in progress) and recent results. */
  async function matView(event: Event, mat: number) {
    const snap = await snapshot(db, event);
    const live = await liveDetails(db, snap, event);
    const queue = (queues(snap, event.settings.mats).get(mat) ?? []).map((q) => (live.has(q.bout.id) ? { ...q, live: live.get(q.bout.id) } : q));
    const recent = await memo(snap, `recent:${mat}`, () =>
      snap.views
        .flatMap((b) => b.bouts.map((x) => ({ bout: x, bracketName: b.name })))
        .filter((x) => x.bout.mat === mat && x.bout.status === "done")
        .sort((x, y) => (y.bout.endedAt?.getTime() ?? 0) - (x.bout.endedAt?.getTime() ?? 0))
        .slice(0, 10),
    );
    return { mat, queue, recent };
  }

  /** Names and teams of everyone in the brackets (for mat views). */
  async function people(event: Event) {
    const snap = await snapshot(db, event);
    return memo(snap, "people", () =>
      db.select({ id: entries.id, firstName: entries.firstName, lastName: entries.lastName, team: entries.team }).from(entries).where(eq(entries.eventId, event.id)),
    );
  }

  const liveTag = (event: Event) => `m${event.version}.${event.liveVersion}.${Math.floor(Date.now() / 10_000)}`;

  /** One mat's line: wrestling now, on deck, in the hole, then the rest, with estimated start times. */
  app.get<{ Params: { slug: string; mat: string } }>("/api/events/:slug/mats/:mat", async (req, reply) => {
    const event = await loadEvent(db, req.params.slug);
    const mat = Number(req.params.mat);
    if (!Number.isInteger(mat) || mat < 1 || mat > event.settings.mats) throw new HttpError(404, "No such mat.");
    if (publicCache(req, reply, `${liveTag(event)}.${mat}`)) return reply;
    const view = await matView(event, mat);
    const ids = new Set([...view.queue.map((q) => q.bout), ...view.recent.map((r) => r.bout)].flatMap((b) => [b.a, b.b]));
    const wrestlers = (await people(event)).filter((p) => ids.has(p.id));
    return { ...view, wrestlers, serverNow: new Date().toISOString() };
  });

  /** Every mat at once (mat board, director console): one request instead of one per mat. */
  app.get<{ Params: { slug: string } }>("/api/events/:slug/mats", async (req, reply) => {
    const event = await loadEvent(db, req.params.slug);
    if (publicCache(req, reply, liveTag(event))) return reply;
    const mats = await Promise.all(Array.from({ length: event.settings.mats }, (_, i) => matView(event, i + 1)));
    const ids = new Set(mats.flatMap((m) => [...m.queue.map((q) => q.bout), ...m.recent.map((r) => r.bout)]).flatMap((b) => [b.a, b.b]));
    const wrestlers = (await people(event)).filter((p) => ids.has(p.id));
    return { mats, wrestlers, serverNow: new Date().toISOString() };
  });

  /** Everything the scoring screen needs for one bout. */
  app.get<{ Params: { slug: string; id: string } }>("/api/events/:slug/bouts/:id", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    const { view, bracketName } = await findBout(db, event, req.params.id);
    const access = await accessFor(db, req, event.id);
    const log = await loadBoutEvents(db, view.id);
    const ruleset = rulesetFor(event);
    const events = toEngineEvents(log);
    const divs = await loadDivisions(db, event.id);
    const ids = [view.a, view.b].filter((x): x is string => !!x && x !== BYE);
    const wrestlers = ids.length
      ? await db.select({ id: entries.id, firstName: entries.firstName, lastName: entries.lastName, team: entries.team, divisionId: entries.divisionId }).from(entries).where(inArray(entries.id, ids))
      : [];
    const division = divs.find((d) => d.id === wrestlers[0]?.divisionId);
    return {
      bout: view,
      bracketName,
      wrestlers,
      periodsSec: division?.periodsSec ?? ruleset.periodsSec,
      rulesetId: ruleset.id,
      ...(access ? { events: log.map((e) => ({ ...e.data, id: e.id, by: e.by, createdAt: e.createdAt })) } : {}),
      state: boutState(ruleset, events),
    };
  });

  /** The table reports its match clock (start, stop, new period, corrections) so live views can show it. */
  app.post<{ Params: { slug: string; id: string } }>("/api/events/:slug/bouts/:id/clock", { config: { live: true } }, async (req) => {
    const event = await loadEvent(db, req.params.slug);
    const access = await requireRole(db, req, event.id, "table");
    const { view } = await findBout(db, event, req.params.id);
    checkMat(access, view);
    const input = z.object({ period: z.number().int().min(1).max(20), remainingSec: z.number().min(0).max(3600), running: z.boolean() }).parse(req.body);
    await db.update(bouts).set({ clock: { ...input, at: new Date().toISOString() } }).where(eq(bouts.id, view.id));
    return { ok: true };
  });

  /** Start the clock on a bout: both wrestlers must be known. */
  app.post<{ Params: { slug: string; id: string } }>("/api/events/:slug/bouts/:id/start", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    const access = await requireRole(db, req, event.id, "table");
    const { view } = await findBout(db, event, req.params.id);
    checkMat(access, view);
    if (view.status !== "ready" && view.status !== "wrestling") {
      throw new HttpError(409, view.status === "done" ? "This bout is already finished." : "Both wrestlers aren't known yet.");
    }
    if (view.status === "ready") {
      await db.update(bouts).set({ startedAt: new Date(), entryA: view.a, entryB: view.b }).where(eq(bouts.id, view.id));
    }
    return { ok: true };
  });

  /**
   * Add scoring events. Ids come from the device, so sending the same event
   * twice (e.g. retrying after a dropped connection) is harmless.
   */
  app.post<{ Params: { slug: string; id: string } }>("/api/events/:slug/bouts/:id/events", { config: { live: true } }, async (req) => {
    const event = await loadEvent(db, req.params.slug);
    const access = await requireRole(db, req, event.id, "table");
    const { view } = await findBout(db, event, req.params.id);
    checkMat(access, view);
    const { events } = z.object({ events: z.array(boutEventInput).min(1).max(200) }).parse(req.body);
    await db
      .insert(boutEvents)
      .values(events.map((e) => ({ id: e.id, boutId: view.id, data: e, by: byOf(access) })))
      .onConflictDoNothing();
    if (!view.startedAt && view.status === "ready") {
      // The first tap starts the bout: that changes the mat line, not just the score.
      await db.update(bouts).set({ startedAt: new Date(), entryA: view.a, entryB: view.b }).where(eq(bouts.id, view.id));
      await bumpVersion(db, event.id);
      scheduler.poke(event.id);
    }
    const log = await loadBoutEvents(db, view.id);
    return { state: boutState(rulesetFor(event), toEngineEvents(log)) };
  });

  /**
   * Record the result, from the live score or entered by hand. Also used to
   * correct a finished bout: the director can always; a table only until a
   * later bout that depends on it has started.
   */
  app.post<{ Params: { slug: string; id: string } }>("/api/events/:slug/bouts/:id/finish", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    const access = await requireRole(db, req, event.id, "table");
    const { view } = await findBout(db, event, req.params.id);
    checkMat(access, view);
    const input = finishInput.parse(req.body);
    const { a, b } = view;
    if (!a || !b || a === BYE || b === BYE) throw new HttpError(409, "Both wrestlers aren't known yet.");

    if (view.status === "done" && access.role === "table") {
      const views = await loadBracketViews(db, event.id);
      const downstream = views
        .flatMap((x) => x.bouts)
        .filter((x) => x.after.some((dep) => dep.boutId === view.id) && (x.startedAt || x.winnerEntryId));
      if (downstream.length) {
        throw new HttpError(403, `A later bout (${downstream[0]!.boutNumber ?? downstream[0]!.key}) has already started. Ask the director to correct this result.`);
      }
    }

    const ruleset = rulesetFor(event);
    let result;
    if (input.mode === "live") {
      const log = await loadBoutEvents(db, view.id);
      result = finalizeBout(ruleset, toEngineEvents(log), input.ending);
    } else {
      result = manualOutcome(ruleset, {
        winner: input.winner,
        winType: input.winType as WinType,
        ...(input.score ? { score: input.score } : {}),
        ...(input.matchTimeSec !== undefined ? { matchTimeSec: input.matchTimeSec } : {}),
      });
    }
    if (!result.ok) throw new HttpError(400, result.message);
    const o = result.outcome;
    const winnerEntryId = o.winner === "A" ? a : b;
    await db
      .update(bouts)
      .set({
        entryA: a,
        entryB: b,
        startedAt: view.startedAt ?? new Date(),
        endedAt: view.endedAt ?? new Date(),
        winnerEntryId,
        result: {
          winner: o.winner,
          winType: o.winType,
          score: o.score,
          summary: o.summary,
          teamPoints: o.teamPoints,
          ...(o.classificationPoints ? { classificationPoints: o.classificationPoints } : {}),
        },
      })
      .where(eq(bouts.id, view.id));

    const after = await loadBracketViews(db, event.id);
    const conflicts = after.flatMap((x) => x.bouts).filter((x) => x.conflict);
    return { result: o, winnerEntryId, conflicts: conflicts.map((c) => ({ id: c.id, boutNumber: c.boutNumber, message: c.conflict })) };
  });

  /**
   * Move a bout (director): to another mat and/or another place in line.
   * `position` is 1-based among that mat's bouts still to wrestle; omit it to
   * go to the end of the line.
   */
  app.patch<{ Params: { slug: string; id: string } }>("/api/events/:slug/bouts/:id", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    const input = z
      .object({ mat: z.number().int().min(1).max(event.settings.mats), position: z.number().int().min(1).optional() })
      .parse(req.body);
    const { view } = await findBout(db, event, req.params.id);
    if (view.status === "done" || view.status === "wrestling") throw new HttpError(409, "This bout has already started, so it can't be moved.");
    if (view.status === "bye" || view.status === "not-needed") throw new HttpError(400, "Byes don't go on a mat.");

    await db.transaction(async (tx) => {
      const views = await loadBracketViews(tx as unknown as Db, event.id);
      const all = views.flatMap((b) => b.bouts);
      // The target mat's line (bouts still to wrestle), without the moving bout.
      const line = all
        .filter((b) => b.mat === input.mat && b.id !== view.id && (b.status === "ready" || b.status === "waiting"))
        .sort((a, b) => (a.matOrder ?? 0) - (b.matOrder ?? 0));
      const at = Math.min((input.position ?? line.length + 1) - 1, line.length);
      line.splice(at, 0, view);
      // Keep finished/started bouts ahead of the line; renumber the line after them.
      const base = Math.max(0, ...all.filter((b) => b.mat === input.mat && b.id !== view.id && !line.includes(b)).map((b) => b.matOrder ?? 0));
      for (const [i, b] of line.entries()) {
        const matOrder = base + i + 1;
        if (b.id === view.id || b.matOrder !== matOrder) {
          await tx.update(bouts).set({ mat: input.mat, matOrder }).where(eq(bouts.id, b.id));
        }
      }
    });
    return { ok: true };
  });

  /** Undo a start or a result (director): the bout goes back to the queue. Scoring history is kept. */
  app.post<{ Params: { slug: string; id: string } }>("/api/events/:slug/bouts/:id/reset", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    const { view } = await findBout(db, event, req.params.id);
    const keepRoundRobinPair = view.section === "pool";
    await db
      .update(bouts)
      .set({
        startedAt: null,
        endedAt: null,
        winnerEntryId: null,
        result: null,
        ...(keepRoundRobinPair ? {} : { entryA: null, entryB: null }),
      })
      .where(and(eq(bouts.id, view.id), eq(bouts.eventId, event.id)));
    return { ok: true };
  });
}
