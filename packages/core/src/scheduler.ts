/**
 * Mat scheduling.
 *
 * `buildSchedule` assigns bouts to mats and orders them, so that:
 *   - a bout never starts before the bouts feeding it are done, plus rest time
 *     for the wrestlers coming out of them,
 *   - bouts only go on mats they're allowed on (e.g. a pool kept on one mat),
 *   - mats stay busy: while one wrestler rests, another ready bout goes.
 * It's greedy list scheduling: whenever a mat frees up, it takes the bout that
 * can start soonest, earliest round first. Fast and predictable.
 *
 * `estimateMatTimes` is the live side: given each mat's queue as it stands
 * (after any director reshuffles), what's wrestling now, on deck and in the
 * hole, and roughly when each bout will start.
 *
 * Times are in minutes from any fixed point (e.g. the event start).
 */

import { type Bracket, type ResolvedBracket, feedingBouts } from "./bracket.js";
import type { PoolBout } from "./roundRobin.js";

export interface RestConstraint {
  boutId: string;
  /** Minutes the wrestler coming out of `boutId` must rest before this bout. */
  restMin: number;
}

export interface SchedulableBout {
  id: string;
  /** Lower goes earlier when several bouts could start. */
  priority: number;
  durationMin: number;
  after: RestConstraint[];
  /** Mats this bout may go on. Omit for any mat. */
  mats?: string[];
}

export interface ScheduledBout {
  boutId: string;
  matId: string;
  start: number;
  end: number;
  /** What the table calls out, e.g. "103" = mat 1, 3rd bout. */
  boutNumber: string;
}

export interface ScheduleOptions {
  /** "per-mat": 101, 102... on mat 1, 201... on mat 2. "sequential": 1, 2, 3 across all mats. */
  numbering?: "per-mat" | "sequential";
  /** Time the mats open. Default 0. */
  startAt?: number;
}

export interface ScheduleResult {
  schedule: ScheduledBout[];
  unscheduled: { boutId: string; reason: string }[];
}

export function buildSchedule(bouts: SchedulableBout[], mats: string[], options: ScheduleOptions = {}): ScheduleResult {
  if (mats.length === 0) throw new Error("Need at least one mat");
  const byId = new Map(bouts.map((b) => [b.id, b]));
  const unscheduled: ScheduleResult["unscheduled"] = [];
  for (const b of bouts) {
    const missing = b.after.find((a) => !byId.has(a.boutId));
    const noMat = b.mats && !b.mats.some((m) => mats.includes(m));
    if (missing) unscheduled.push({ boutId: b.id, reason: `Depends on unknown bout ${missing.boutId}` });
    else if (noMat) unscheduled.push({ boutId: b.id, reason: `None of its mats (${b.mats!.join(", ")}) exist` });
  }

  const blocked = new Set(unscheduled.map((u) => u.boutId));
  // Anything depending on a blocked bout is blocked too.
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of bouts) {
      if (!blocked.has(b.id) && b.after.some((a) => blocked.has(a.boutId))) {
        blocked.add(b.id);
        unscheduled.push({ boutId: b.id, reason: "Depends on a bout that can't be scheduled" });
        changed = true;
      }
    }
  }

  const start0 = options.startAt ?? 0;
  const freeAt = new Map(mats.map((m) => [m, start0]));
  // Mats with nothing they can take right now. They wake whenever a bout is
  // placed anywhere, since that may unlock work for them.
  const sleeping = new Set<string>();
  const ends = new Map<string, number>();
  const placed: { boutId: string; matId: string; start: number; end: number }[] = [];
  const pending = new Set(bouts.filter((b) => !blocked.has(b.id)).map((b) => b.id));

  while (pending.size > 0) {
    const activeMats = mats.filter((m) => !sleeping.has(m));
    if (activeMats.length === 0) break;
    const mat = activeMats.reduce((a, b) => (freeAt.get(b)! < freeAt.get(a)! ? b : a));
    const now = freeAt.get(mat)!;

    let pick: SchedulableBout | undefined;
    let pickStart = Infinity;
    for (const id of pending) {
      const b = byId.get(id)!;
      if (b.mats && !b.mats.includes(mat)) continue;
      if (!b.after.every((a) => ends.has(a.boutId))) continue;
      const ready = Math.max(now, ...b.after.map((a) => ends.get(a.boutId)! + a.restMin));
      if (ready < pickStart || (ready === pickStart && pick && b.priority < pick.priority)) {
        pick = b;
        pickStart = ready;
      }
    }

    if (!pick) {
      sleeping.add(mat);
      continue;
    }

    const end = pickStart + pick.durationMin;
    placed.push({ boutId: pick.id, matId: mat, start: pickStart, end });
    ends.set(pick.id, end);
    freeAt.set(mat, end);
    pending.delete(pick.id);
    sleeping.clear();
  }

  for (const id of pending) {
    unscheduled.push({ boutId: id, reason: "Dependencies never finish (check for a cycle or mat restrictions)" });
  }

  return { schedule: numberBouts(placed, mats, options.numbering ?? "per-mat"), unscheduled };
}

function numberBouts(
  placed: { boutId: string; matId: string; start: number; end: number }[],
  mats: string[],
  numbering: "per-mat" | "sequential",
): ScheduledBout[] {
  const ordered = [...placed].sort((a, b) => a.start - b.start || mats.indexOf(a.matId) - mats.indexOf(b.matId));
  if (numbering === "sequential") return ordered.map((p, i) => ({ ...p, boutNumber: String(i + 1) }));
  const perMat = new Map<string, number>();
  for (const p of ordered) perMat.set(p.matId, (perMat.get(p.matId) ?? 0) + 1);
  const digits = Math.max(2, String(Math.max(...perMat.values())).length);
  const seq = new Map<string, number>();
  return ordered.map((p) => {
    const n = (seq.get(p.matId) ?? 0) + 1;
    seq.set(p.matId, n);
    return { ...p, boutNumber: `${mats.indexOf(p.matId) + 1}${String(n).padStart(digits, "0")}` };
  });
}

// ---------------------------------------------------------------------------
// Turning pools and brackets into schedulable bouts
// ---------------------------------------------------------------------------

export interface BoutTiming {
  durationMin: number;
  restMin: number;
  /** Added to every bout's priority, to order divisions within a round. */
  priorityOffset?: number;
  mats?: string[];
}

/**
 * Pool bouts. Each wrestler must rest between their own bouts. `prefix`
 * makes ids unique across pools, e.g. "10U-03:" gives "10U-03:1".
 */
export function poolScheduleBouts(prefix: string, bouts: PoolBout[], timing: BoutTiming): SchedulableBout[] {
  const lastBout = new Map<string, string>();
  return bouts.map((b) => {
    const id = `${prefix}${b.order}`;
    const after = [b.wrestler1, b.wrestler2]
      .map((w) => lastBout.get(w))
      .filter((x): x is string => x !== undefined)
      .map((boutId) => ({ boutId, restMin: timing.restMin }));
    lastBout.set(b.wrestler1, id);
    lastBout.set(b.wrestler2, id);
    return {
      id,
      priority: b.round * 1000 + (timing.priorityOffset ?? 0),
      durationMin: timing.durationMin,
      after,
      ...(timing.mats ? { mats: timing.mats } : {}),
    };
  });
}

/**
 * Bracket bouts that will actually be wrestled (byes and not-needed bouts
 * left out), with rest after every bout that feeds each one.
 */
export function bracketScheduleBouts(
  prefix: string,
  bracket: Bracket,
  resolved: ResolvedBracket,
  timing: BoutTiming,
): SchedulableBout[] {
  const real = resolved.bouts.filter((r) => r.status !== "bye" && r.status !== "not-needed");
  return real.map((r) => ({
    id: `${prefix}${r.bout.id}`,
    priority: r.bout.round * 1000 + (timing.priorityOffset ?? 0),
    durationMin: timing.durationMin,
    after: feedingBouts(resolved, r.bout.id).map((f) => ({ boutId: `${prefix}${f}`, restMin: timing.restMin })),
    ...(timing.mats ? { mats: timing.mats } : {}),
  }));
}

/**
 * Spread groups (pools/brackets) over mats so total wrestling time is even,
 * biggest first. Keeping a group on one mat is easier for parents to follow.
 */
export function assignGroupsToMats(groups: { id: string; minutes: number }[], mats: string[]): Map<string, string> {
  const load = new Map(mats.map((m) => [m, 0]));
  const assignment = new Map<string, string>();
  for (const g of [...groups].sort((a, b) => b.minutes - a.minutes || a.id.localeCompare(b.id))) {
    const mat = mats.reduce((a, b) => (load.get(b)! < load.get(a)! ? b : a));
    assignment.set(g.id, mat);
    load.set(mat, load.get(mat)! + g.minutes);
  }
  return assignment;
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/**
 * Planning estimate for one bout: full match time plus breaks plus overhead
 * (walk-on, handshake, stoppages, result entry). Plans are refined during the
 * event with `rollingAverage` of real bout times.
 */
export function estimateBoutMinutes(periodsSec: number[], breakSec = 30, overheadMin = 2): number {
  const matchSec = periodsSec.reduce((a, b) => a + b, 0) + Math.max(0, periodsSec.length - 1) * breakSec;
  return Math.round((matchSec / 60 + overheadMin) * 10) / 10;
}

/** Average of the last `window` real bout times, or the fallback if there are none yet. */
export function rollingAverage(actualMinutes: number[], fallback: number, window = 10): number {
  const recent = actualMinutes.slice(-window);
  if (recent.length === 0) return fallback;
  return Math.round((recent.reduce((a, b) => a + b, 0) / recent.length) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Live estimates: now / on deck / in the hole
// ---------------------------------------------------------------------------

export interface MatState {
  matId: string;
  current?: { boutId: string; startedAt: number; durationMin: number };
  /** Bouts not started yet, in the order the table will call them. */
  queue: { boutId: string; durationMin: number; after: RestConstraint[] }[];
}

export type QueuePosition = "wrestling" | "on-deck" | "in-the-hole" | "queued";

export interface BoutEstimate {
  boutId: string;
  matId: string;
  position: QueuePosition;
  /** 0 = wrestling now, 1 = on deck, 2 = in the hole, ... */
  place: number;
  estimatedStart: number;
  /**
   * Set when the bout is expected to wait for a wrestler's rest, so the mat
   * would sit idle. The table can wrestle a later ready bout instead.
   */
  restHoldUntil?: number;
}

/**
 * Estimated start times for every queued bout. `finished` holds end times of
 * completed bouts (for rest). Bouts that depend on a bout nobody has queued
 * are left out; they can't be estimated.
 */
export function estimateMatTimes(mats: MatState[], finished: Map<string, number>, now: number): BoutEstimate[] {
  const ends = new Map(finished);
  const estimates: BoutEstimate[] = [];
  const freeAt = new Map<string, number>();
  const heads = new Map<string, number>();

  for (const m of mats) {
    if (m.current) {
      const end = Math.max(now, m.current.startedAt + m.current.durationMin);
      ends.set(m.current.boutId, end);
      freeAt.set(m.matId, end);
      estimates.push({
        boutId: m.current.boutId,
        matId: m.matId,
        position: "wrestling",
        place: 0,
        estimatedStart: m.current.startedAt,
      });
    } else {
      freeAt.set(m.matId, now);
    }
    heads.set(m.matId, 0);
  }

  // Walk the queues in time order. A mat's next bout can be estimated once
  // every bout it depends on has an estimated end.
  for (;;) {
    let bestMat: MatState | undefined;
    for (const m of mats) {
      const next = m.queue[heads.get(m.matId)!];
      if (!next || !next.after.every((a) => ends.has(a.boutId))) continue;
      if (!bestMat || freeAt.get(m.matId)! < freeAt.get(bestMat.matId)!) bestMat = m;
    }
    if (!bestMat) break;

    const i = heads.get(bestMat.matId)!;
    const bout = bestMat.queue[i]!;
    const free = freeAt.get(bestMat.matId)!;
    const ready = Math.max(free, ...bout.after.map((a) => ends.get(a.boutId)! + a.restMin));
    // With nothing on the mat, the first queued bout is on deck, not wrestling.
    const place = i + 1;
    estimates.push({
      boutId: bout.boutId,
      matId: bestMat.matId,
      position: place === 1 ? "on-deck" : place === 2 ? "in-the-hole" : "queued",
      place,
      estimatedStart: ready,
      ...(ready > free ? { restHoldUntil: ready } : {}),
    });
    ends.set(bout.boutId, ready + bout.durationMin);
    freeAt.set(bestMat.matId, ready + bout.durationMin);
    heads.set(bestMat.matId, i + 1);
  }

  return estimates;
}
