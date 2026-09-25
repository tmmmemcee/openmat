/**
 * Per-tournament snapshot cache: the expensive part of every page (resolving
 * every bracket, working out mat lines and live scores) is done once per
 * change instead of once per viewer.
 *
 * Every change bumps the event's `version` (or `liveVersion` for scoring taps
 * and clock updates). A request reads the event row (one small query), and
 * reuses the snapshot when the versions match. Mat lines also depend on the
 * time (estimated starts), so they're rebuilt at most every QUEUE_TTL_MS.
 */
import { RULESETS, boutState } from "@openmat/core";
import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { boutEvents, bouts, events } from "../db/schema.js";
import { type QueueItem, matQueues } from "./live.js";
import { type BracketView, loadBracketViews, toEngineEvents } from "./tournament.js";

type EventRow = typeof events.$inferSelect;

export interface LiveDetails {
  score: { A: number; B: number };
  position: "neutral" | "A-top" | "B-top" | null;
  clock: BracketView["bouts"][number]["clock"] | null;
}

interface Snapshot {
  eventId: string;
  version: number;
  views: BracketView[];
  queues?: { at: number; byMat: Map<number, QueueItem[]> };
  live?: { liveVersion: number; byBout: Map<string, LiveDetails> };
  /** Ready-made response bodies and other derived data, per version. */
  memo: Map<string, unknown>;
}

const MAX_EVENTS = 500;
const QUEUE_TTL_MS = 10_000;
const cache = new Map<string, Snapshot>();
const building = new Map<string, Promise<Snapshot>>();

/** The snapshot for this event's current version, built if needed (once, even with concurrent requests). */
export async function snapshot(db: Db, event: EventRow): Promise<Snapshot> {
  const hit = cache.get(event.id);
  if (hit && hit.version === event.version) {
    // Refresh LRU position.
    cache.delete(event.id);
    cache.set(event.id, hit);
    return hit;
  }
  const key = `${event.id}:${event.version}`;
  const pending = building.get(key);
  if (pending) return pending;
  const job = (async () => {
    const snap: Snapshot = { eventId: event.id, version: event.version, views: await loadBracketViews(db, event.id), memo: new Map() };
    cache.delete(event.id);
    cache.set(event.id, snap);
    while (cache.size > MAX_EVENTS) cache.delete(cache.keys().next().value!);
    return snap;
  })();
  building.set(key, job);
  try {
    return await job;
  } finally {
    building.delete(key);
  }
}

/** Mat lines with estimated starts; reused for a few seconds. */
export function queues(snap: Snapshot, mats: number, now = Date.now()): Map<number, QueueItem[]> {
  if (!snap.queues || now - snap.queues.at > QUEUE_TTL_MS) {
    snap.queues = { at: now, byMat: matQueues(snap.views, mats, new Date(now)) };
  }
  return snap.queues.byMat;
}

/** Score, position and clock for every bout being wrestled, per live version. */
export async function liveDetails(db: Db, snap: Snapshot, event: EventRow): Promise<Map<string, LiveDetails>> {
  if (snap.live?.liveVersion === event.liveVersion) return snap.live.byBout;
  const ruleset = RULESETS.find((r) => r.id === event.rulesetId);
  const wrestling = snap.views.flatMap((b) => b.bouts).filter((b) => b.status === "wrestling");
  const byBout = new Map<string, LiveDetails>();
  if (ruleset && wrestling.length) {
    const rows = await db
      .select()
      .from(boutEvents)
      .where(inArray(boutEvents.boutId, wrestling.map((b) => b.id)))
      .orderBy(boutEvents.seq);
    // Clocks change without a structure change, so read them fresh.
    const clocks = new Map(
      (await db.select({ id: bouts.id, clock: bouts.clock }).from(bouts).where(inArray(bouts.id, wrestling.map((b) => b.id)))).map((r) => [r.id, r.clock]),
    );
    const grouped = Map.groupBy(rows, (r) => r.boutId);
    for (const b of wrestling) {
      const state = boutState(ruleset, toEngineEvents(grouped.get(b.id) ?? []));
      byBout.set(b.id, { score: state.score, position: ruleset.tracksPosition ? state.position : null, clock: clocks.get(b.id) ?? null });
    }
  }
  snap.live = { liveVersion: event.liveVersion, byBout };
  return byBout;
}

/** Memoize anything derived from the snapshot (e.g. a serialized response) for this version. */
export async function memo<T>(snap: Snapshot, key: string, make: () => T | Promise<T>): Promise<T> {
  if (snap.memo.has(key)) return snap.memo.get(key) as T;
  const value = await make();
  snap.memo.set(key, value);
  return value;
}

/** Record a change so cached views are rebuilt. `live` for scoring taps and clock updates. */
export async function bumpVersion(db: Db, eventId: string, kind: "structure" | "live" = "structure"): Promise<void> {
  if (kind === "live") await db.update(events).set({ liveVersion: sql`${events.liveVersion} + 1` }).where(eq(events.id, eventId));
  else await db.update(events).set({ version: sql`${events.version} + 1` }).where(eq(events.id, eventId));
}

/** For tests. */
export function clearSnapshots(): void {
  cache.clear();
}
