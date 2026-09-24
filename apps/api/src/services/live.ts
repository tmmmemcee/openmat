/**
 * Live mat queues: what's wrestling, on deck and in the hole on each mat, and
 * estimated start times based on how long bouts are really taking.
 */
import { type MatState, estimateMatTimes, rollingAverage } from "@openmat/core";
import type { BoutView, BracketView } from "./tournament.js";

export interface QueueItem {
  bout: BoutView;
  bracketName: string;
  position: "wrestling" | "on-deck" | "in-the-hole" | "queued";
  place: number;
  estimatedStart: string | null;
  restHoldUntil: string | null;
}

const toMin = (d: Date) => d.getTime() / 60000;
const fromMin = (m: number) => new Date(Math.round(m * 60000)).toISOString();

/** Queues for every mat, in call order. Bouts that can't be wrestled yet (waiting on results) are included without an ETA. */
export function matQueues(views: BracketView[], mats: number, now = new Date()): Map<number, QueueItem[]> {
  const bracketName = new Map(views.map((b) => [b.id, b.name]));
  const all = views.flatMap((b) => b.bouts);
  const finished = new Map<string, number>();
  for (const b of all) if (b.endedAt) finished.set(b.id, toMin(b.endedAt));

  const states: MatState[] = [];
  const queues = new Map<number, BoutView[]>();
  for (let mat = 1; mat <= mats; mat++) {
    const onMat = all.filter((b) => b.mat === mat);
    // Real bout lengths on this mat, oldest first.
    const actual = onMat
      .filter((b) => b.startedAt && b.endedAt)
      .sort((x, y) => x.endedAt!.getTime() - y.endedAt!.getTime())
      .map((b) => (b.endedAt!.getTime() - b.startedAt!.getTime()) / 60000);
    const current = onMat.find((b) => b.status === "wrestling");
    const queue = onMat
      .filter((b) => b.status === "ready" || b.status === "waiting")
      .sort((x, y) => (x.matOrder ?? 0) - (y.matOrder ?? 0));
    queues.set(mat, [...(current ? [current] : []), ...queue]);
    const duration = (b: BoutView) => rollingAverage(actual, b.durationMin);
    states.push({
      matId: String(mat),
      ...(current ? { current: { boutId: current.id, startedAt: toMin(current.startedAt!), durationMin: duration(current) } } : {}),
      queue: queue.map((b) => ({ boutId: b.id, durationMin: duration(b), after: b.after })),
    });
  }

  const estimates = new Map(estimateMatTimes(states, finished, toMin(now)).map((e) => [e.boutId, e]));
  const out = new Map<number, QueueItem[]>();
  for (const [mat, list] of queues) {
    out.set(
      mat,
      list.map((bout, i) => {
        const e = estimates.get(bout.id);
        const place = bout.status === "wrestling" ? 0 : list[0]?.status === "wrestling" ? i : i + 1;
        return {
          bout,
          bracketName: bracketName.get(bout.bracketId) ?? "",
          position: place === 0 ? "wrestling" : place === 1 ? "on-deck" : place === 2 ? "in-the-hole" : "queued",
          place,
          estimatedStart: e ? fromMin(e.estimatedStart) : null,
          restHoldUntil: e?.restHoldUntil !== undefined ? fromMin(e.restHoldUntil) : null,
        };
      }),
    );
  }
  return out;
}
