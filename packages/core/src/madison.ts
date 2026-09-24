/**
 * Youth "Madison" grouping: put wrestlers into small groups (pools) of
 * similar weight instead of fixed weight classes.
 *
 * Within each age division, wrestlers are sorted by weight and split into
 * consecutive runs. A dynamic program picks the split with the lowest total
 * cost, preferring (in order):
 *   1. nobody left alone (a group of 1 gets no matches),
 *   2. every group within the weight tolerance (default 10%),
 *   3. no group smaller than the minimum size,
 *   4. group sizes close to the target size,
 *   5. tighter weight spreads.
 * Anything that breaks a rule is still grouped, but flagged, so the director
 * can see it and decide. Nothing is hidden.
 *
 * Wrestlers can be bumped UP an age division and/or UP a weight group, never
 * down.
 */

import { type AgeDivision, effectiveDivision, sortDivisions } from "./divisions.js";

export interface GroupingEntry {
  id: string;
  name: string;
  /** Weigh-in (scratch) weight. Any unit, as long as it's the same for everyone. */
  weight: number;
  /** Age division the wrestler naturally belongs to, e.g. "10U". */
  division: string;
  team?: string;
  /** Move up this many age divisions (0 = none). */
  bumpAge?: number;
  /** Move up this many weight groups within the division (0 = none). */
  bumpWeight?: number;
}

export interface GroupingOptions {
  /** Ideal group size (4 = each kid gets 3 matches in a round robin). */
  targetSize: number;
  /** Groups smaller than this are flagged. */
  minSize: number;
  /** Groups are never made larger than this. */
  maxSize: number;
  /** Max allowed spread, as % of the lightest wrestler: (heaviest - lightest) / lightest. */
  maxSpreadPct: number;
  /**
   * Always allow at least this many units of spread, even when the % rule is
   * tighter. Useful for the lightest kids (10% of 45 lb is only 4.5 lb).
   */
  spreadFloor: number;
}

export const DEFAULT_GROUPING_OPTIONS: GroupingOptions = {
  targetSize: 4,
  minSize: 3,
  maxSize: 5,
  maxSpreadPct: 10,
  spreadFloor: 0,
};

export type GroupFlag =
  | { type: "weight-spread"; spreadPct: number; allowedPct: number }
  | { type: "undersized"; size: number; minSize: number }
  | { type: "alone"; wrestlerId: string }
  | { type: "wrestling-up-age"; wrestlerId: string; from: string; to: string }
  | { type: "wrestling-up-weight"; wrestlerId: string; groupsUp: number };

export interface Group {
  id: string;
  division: string;
  /** 1-based, lightest group in the division is 1. */
  number: number;
  members: GroupingEntry[];
  minWeight: number;
  maxWeight: number;
  /** Spread among wrestlers at their natural weight (weight bump-ups excluded). */
  spreadPct: number;
  flags: GroupFlag[];
}

export interface UnplacedEntry {
  entry: GroupingEntry;
  reason: "no-older-division" | "no-heavier-group" | "unknown-division";
  message: string;
}

export interface GroupingResult {
  groups: Group[];
  unplaced: UnplacedEntry[];
}

// Costs. Relative sizes encode the priority order in the header comment.
const COST_ALONE = 10_000;
const COST_SPREAD_VIOLATION = 200;
const COST_SPREAD_VIOLATION_PER_PCT = 20;
const COST_UNDERSIZED_PER_MISSING = 300;
const COST_SIZE_DEVIATION = 10;
const COST_SPREAD_PER_PCT = 1;

function spreadPct(weights: number[]): number {
  if (weights.length < 2) return 0;
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  return min > 0 ? ((max - min) / min) * 100 : 0;
}

function allowedPct(minWeight: number, opts: GroupingOptions): number {
  const floorPct = minWeight > 0 ? (opts.spreadFloor / minWeight) * 100 : 0;
  return Math.max(opts.maxSpreadPct, floorPct);
}

function groupCost(sortedWeights: number[], totalInDivision: number, opts: GroupingOptions): number {
  const size = sortedWeights.length;
  const min = sortedWeights[0]!;
  const spread = spreadPct(sortedWeights);
  const allowed = allowedPct(min, opts);
  let cost = COST_SIZE_DEVIATION * (size - opts.targetSize) ** 2 + COST_SPREAD_PER_PCT * spread;
  if (spread > allowed) cost += COST_SPREAD_VIOLATION + COST_SPREAD_VIOLATION_PER_PCT * (spread - allowed);
  // Only penalize small groups when a bigger one was actually possible.
  if (size < opts.minSize && totalInDivision >= opts.minSize) {
    cost += COST_UNDERSIZED_PER_MISSING * (opts.minSize - size);
  }
  if (size === 1 && totalInDivision > 1) cost += COST_ALONE;
  return cost;
}

/** Optimal split of weight-sorted entries into consecutive groups. */
function partition(sorted: GroupingEntry[], opts: GroupingOptions): GroupingEntry[][] {
  const n = sorted.length;
  if (n === 0) return [];
  const weights = sorted.map((e) => e.weight);
  const best: number[] = new Array(n + 1).fill(Infinity);
  const cut: number[] = new Array(n + 1).fill(0);
  best[0] = 0;
  for (let end = 1; end <= n; end++) {
    for (let size = 1; size <= opts.maxSize && size <= end; size++) {
      const start = end - size;
      const cost = best[start]! + groupCost(weights.slice(start, end), n, opts);
      if (cost < best[end]!) {
        best[end] = cost;
        cut[end] = start;
      }
    }
  }
  const groups: GroupingEntry[][] = [];
  for (let end = n; end > 0; end = cut[end]!) groups.unshift(sorted.slice(cut[end], end));
  return groups;
}

/** Recompute weights, spread and flags for a group, e.g. after a director edits it by hand. */
export function evaluateGroup(
  id: string,
  division: string,
  number: number,
  members: GroupingEntry[],
  opts: GroupingOptions = DEFAULT_GROUPING_OPTIONS,
  ageBumps: Map<string, { from: string; to: string }> = new Map(),
): Group {
  const sorted = [...members].sort(byWeightThenId);
  const natural = sorted.filter((m) => !(m.bumpWeight && m.bumpWeight > 0));
  const naturalWeights = natural.map((m) => m.weight);
  const weights = sorted.map((m) => m.weight);
  const spread = spreadPct(naturalWeights);
  const flags: GroupFlag[] = [];

  if (natural.length > 0) {
    const allowed = allowedPct(Math.min(...naturalWeights), opts);
    if (spread > allowed) flags.push({ type: "weight-spread", spreadPct: round1(spread), allowedPct: round1(allowed) });
  }
  if (sorted.length === 1) flags.push({ type: "alone", wrestlerId: sorted[0]!.id });
  else if (sorted.length < opts.minSize) flags.push({ type: "undersized", size: sorted.length, minSize: opts.minSize });

  for (const m of sorted) {
    const bump = ageBumps.get(m.id);
    if (bump) flags.push({ type: "wrestling-up-age", wrestlerId: m.id, from: bump.from, to: bump.to });
    if (m.bumpWeight && m.bumpWeight > 0) {
      flags.push({ type: "wrestling-up-weight", wrestlerId: m.id, groupsUp: m.bumpWeight });
    }
  }

  return {
    id,
    division,
    number,
    members: sorted,
    minWeight: weights.length ? Math.min(...weights) : 0,
    maxWeight: weights.length ? Math.max(...weights) : 0,
    spreadPct: round1(spread),
    flags,
  };
}

/**
 * Group all entries, division by division.
 * `divisions` defines which divisions exist and their order (for age bump-ups).
 */
export function groupWrestlers(
  entries: GroupingEntry[],
  divisions: AgeDivision[],
  options: Partial<GroupingOptions> = {},
): GroupingResult {
  const opts = { ...DEFAULT_GROUPING_OPTIONS, ...options };
  validateOptions(opts);
  const unplaced: UnplacedEntry[] = [];
  const byDivision = new Map<string, GroupingEntry[]>();
  const ageBumps = new Map<string, { from: string; to: string }>();

  for (const e of entries) {
    const bumpAge = e.bumpAge ?? 0;
    const bumpWeight = e.bumpWeight ?? 0;
    if (bumpAge < 0 || bumpWeight < 0) {
      throw new RangeError(`Wrestler ${e.id} has a negative bump. Wrestlers can only move up, never down.`);
    }
    let target: AgeDivision | undefined;
    try {
      target = effectiveDivision(e.division, bumpAge, divisions);
    } catch {
      unplaced.push({ entry: e, reason: "unknown-division", message: `Unknown age division "${e.division}".` });
      continue;
    }
    if (!target) {
      unplaced.push({
        entry: e,
        reason: "no-older-division",
        message: `${e.name} can't move up ${bumpAge} age division(s) from ${e.division}; there is no older division.`,
      });
      continue;
    }
    if (bumpAge > 0) ageBumps.set(e.id, { from: e.division, to: target.name });
    const list = byDivision.get(target.name) ?? [];
    list.push(e);
    byDivision.set(target.name, list);
  }

  const groups: Group[] = [];
  for (const division of sortDivisions(divisions)) {
    const inDivision = byDivision.get(division.name);
    if (!inDivision?.length) continue;

    const natural = inDivision.filter((e) => !(e.bumpWeight && e.bumpWeight > 0)).sort(byWeightThenId);
    const bumped = inDivision.filter((e) => e.bumpWeight && e.bumpWeight > 0).sort(byWeightThenId);
    const runs = partition(natural, opts);

    for (const e of bumped) {
      if (runs.length === 0) {
        unplaced.push({
          entry: e,
          reason: "no-heavier-group",
          message: `${e.name} can't move up a weight group in ${division.name}; there are no other wrestlers to group with.`,
        });
        continue;
      }
      const target = closestRun(runs, e.weight) + e.bumpWeight!;
      if (target >= runs.length) {
        unplaced.push({
          entry: e,
          reason: "no-heavier-group",
          message: `${e.name} can't move up ${e.bumpWeight} weight group(s) in ${division.name}; there aren't enough heavier groups.`,
        });
        continue;
      }
      runs[target]!.push(e);
    }

    runs.forEach((members, i) => {
      const number = i + 1;
      groups.push(evaluateGroup(`${division.name}-${pad(number)}`, division.name, number, members, opts, ageBumps));
    });
  }

  return { groups, unplaced };
}

/** Index of the group whose weight range is closest to `weight`. */
function closestRun(runs: GroupingEntry[][], weight: number): number {
  let bestIndex = 0;
  let bestDistance = Infinity;
  runs.forEach((run, i) => {
    const min = run[0]!.weight;
    const max = run[run.length - 1]!.weight;
    const distance = weight < min ? min - weight : weight > max ? weight - max : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  });
  return bestIndex;
}

function validateOptions(o: GroupingOptions): void {
  if (o.minSize < 1 || o.maxSize < o.minSize || o.targetSize < o.minSize || o.targetSize > o.maxSize) {
    throw new RangeError("Group sizes must satisfy 1 <= minSize <= targetSize <= maxSize");
  }
  if (o.maxSpreadPct < 0 || o.spreadFloor < 0) throw new RangeError("Spread limits can't be negative");
}

function byWeightThenId(a: GroupingEntry, b: GroupingEntry): number {
  return a.weight - b.weight || a.id.localeCompare(b.id);
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
