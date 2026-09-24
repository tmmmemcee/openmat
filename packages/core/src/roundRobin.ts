/**
 * Round robin pools: everyone in a group wrestles everyone else once.
 */

export interface PoolBout {
  /** 1-based round number. Each wrestler has at most one bout per round. */
  round: number;
  /** 1-based order within the whole pool. */
  order: number;
  wrestler1: string;
  wrestler2: string;
}

/**
 * Pairings by the circle method. Within each round, bouts are ordered so a
 * wrestler who just finished the previous round's last bout doesn't go again
 * immediately, when that can be avoided. (In pools of 3 or 4 it can't: every
 * bout in the next round involves someone from the bout that just ended. The
 * scheduler interleaves other pools on the mat to give rest.)
 */
export function roundRobin(wrestlerIds: string[]): PoolBout[] {
  if (new Set(wrestlerIds).size !== wrestlerIds.length) throw new Error("Duplicate wrestler in pool");
  if (wrestlerIds.length < 2) return [];

  const slots: (string | null)[] = [...wrestlerIds];
  if (slots.length % 2 === 1) slots.push(null); // bye
  const n = slots.length;

  const rounds: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = slots[i];
      const b = slots[n - 1 - i];
      if (a && b) pairs.push([a, b]);
    }
    rounds.push(pairs);
    // Keep the first slot fixed, rotate the rest one step.
    slots.splice(1, 0, slots.pop()!);
  }

  const bouts: PoolBout[] = [];
  let justWrestled = new Set<string>();
  rounds.forEach((pairs, r) => {
    const ordered = [...pairs].sort((p, q) => rested(p, justWrestled) - rested(q, justWrestled));
    for (const [a, b] of ordered) bouts.push({ round: r + 1, order: bouts.length + 1, wrestler1: a, wrestler2: b });
    const last = ordered[ordered.length - 1];
    justWrestled = new Set(last ?? []);
  });
  return bouts;
}

/** 0 if neither wrestler just wrestled, 1 otherwise (so rested pairs sort first). */
function rested(pair: [string, string], justWrestled: Set<string>): number {
  return justWrestled.has(pair[0]) || justWrestled.has(pair[1]) ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export type WinType =
  | "DEC" // decision
  | "MD" // major decision
  | "TF" // technical fall
  | "FALL" // pin
  | "FOR" // forfeit
  | "INJ" // injury default
  | "DQ" // disqualification
  | "MFF"; // medical forfeit

export interface BoutResult {
  wrestler1: string;
  wrestler2: string;
  winner: string;
  winType: WinType;
  /** Elapsed match time of a fall, in seconds. */
  fallTimeSec?: number;
}

export interface Standing {
  wrestlerId: string;
  place: number;
  wins: number;
  losses: number;
  falls: number;
  /** True when the tiebreakers couldn't separate this wrestler from another; the director must decide. */
  unresolvedTie: boolean;
  /** How this wrestler's place was decided relative to the wrestlers tied with them on wins. */
  tiebreak?: "head-to-head" | "falls" | "fastest-falls";
}

/**
 * Pool placings. Order: most wins; ties broken by
 *   1. head-to-head wins among the tied wrestlers,
 *   2. most falls,
 *   3. least total fall time,
 * and anything still tied is flagged for the director (coin flip or re-match).
 */
export function poolStandings(wrestlerIds: string[], results: BoutResult[]): Standing[] {
  const stats = new Map(
    wrestlerIds.map((id) => [id, { wins: 0, losses: 0, falls: 0, fallTime: 0 }]),
  );
  for (const r of results) {
    const loser = r.winner === r.wrestler1 ? r.wrestler2 : r.wrestler1;
    const w = stats.get(r.winner);
    const l = stats.get(loser);
    if (!w || !l) throw new Error(`Result references a wrestler not in the pool: ${r.wrestler1} vs ${r.wrestler2}`);
    w.wins++;
    l.losses++;
    if (r.winType === "FALL") {
      w.falls++;
      w.fallTime += r.fallTimeSec ?? 0;
    }
  }

  type Bucket = { ids: string[]; tiebreak?: Standing["tiebreak"]; unresolved?: Set<string> };

  const rank = (ids: string[]): Bucket[] => {
    // Returns ordered buckets; ids in the same bucket are still tied.
    const buckets = bucketBy(ids, (id) => -stats.get(id)!.wins);
    return buckets.flatMap((bucket) => (bucket.length === 1 ? [{ ids: bucket }] : breakTie(bucket)));
  };

  const breakTie = (tied: string[]): Bucket[] => {
    const tiedSet = new Set(tied);
    const h2h = (id: string) =>
      results.filter((r) => r.winner === id && tiedSet.has(r.wrestler1) && tiedSet.has(r.wrestler2)).length;
    const steps: [NonNullable<Standing["tiebreak"]>, (id: string) => number][] = [
      ["head-to-head", (id) => -h2h(id)],
      ["falls", (id) => -stats.get(id)!.falls],
      ["fastest-falls", (id) => (stats.get(id)!.falls > 0 ? stats.get(id)!.fallTime : Infinity)],
    ];
    for (const [name, key] of steps) {
      const buckets = bucketBy(tied, key);
      if (buckets.length > 1) {
        // Split achieved. Re-rank each sub-bucket from scratch (a smaller tied
        // set can have a different head-to-head outcome).
        return buckets.flatMap((b) =>
          b.length === 1 ? [{ ids: b, tiebreak: name }] : breakTie(b).map((x): Bucket => ({ ...x, tiebreak: x.tiebreak ?? name })),
        );
      }
    }
    return [{ ids: [...tied].sort(), unresolved: tiedSet }];
  };

  const standings: Standing[] = [];
  for (const bucket of rank(wrestlerIds)) {
    const place = standings.length + 1;
    for (const id of bucket.ids) {
      const s = stats.get(id)!;
      standings.push({
        wrestlerId: id,
        place,
        wins: s.wins,
        losses: s.losses,
        falls: s.falls,
        unresolvedTie: bucket.unresolved?.has(id) ?? false,
        ...(bucket.tiebreak ? { tiebreak: bucket.tiebreak } : {}),
      });
    }
  }
  return standings;
}

/** Group ids by key (ascending), preserving order inside each bucket. */
function bucketBy(ids: string[], key: (id: string) => number): string[][] {
  const map = new Map<number, string[]>();
  for (const id of ids) {
    const k = key(id);
    map.set(k, [...(map.get(k) ?? []), id]);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}
