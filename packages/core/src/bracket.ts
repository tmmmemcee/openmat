/**
 * Elimination brackets as a graph of bouts. Each bout has two slots, and each
 * slot says where its wrestler comes from: a seed line, or the winner/loser
 * of an earlier bout. One engine (`resolveBracket`) then works out who is in
 * every bout, handles byes, and computes placements, for every format.
 *
 * Formats:
 *   - single elimination (optional 3rd place bout)
 *   - double elimination / "wrestleback" consolation, placing 4, 6 or 8 deep,
 *     with losers crossing over so early rematches are avoided, and an
 *     optional true-second bout.
 */

export type SlotSource =
  | { kind: "seed"; seed: number }
  | { kind: "winner"; bout: string }
  | { kind: "loser"; bout: string };

export type BracketSection = "championship" | "consolation" | "placement";

export interface BracketBout {
  /** Stable id within the bracket, e.g. "W2-3" (championship round 2, bout 3). */
  id: string;
  section: BracketSection;
  /** Order in which rounds are wrestled. Bouts in the same round can run at the same time. */
  round: number;
  /** Plain-English name, e.g. "Quarterfinal", "Consolation Round 2", "3rd Place". */
  label: string;
  top: SlotSource;
  bottom: SlotSource;
  /** The winner of this bout places here and the loser one place lower. */
  forPlace?: number;
  /** Only wrestled if needed, i.e. the two haven't met yet in this bracket. */
  conditional?: "true-second";
}

export interface Bracket {
  format: "single-elim" | "double-elim";
  /** Number of seed lines (a power of 2). */
  size: number;
  /** In dependency order: every bout comes after the bouts that feed it. */
  bouts: BracketBout[];
}

export interface SingleElimOptions {
  thirdPlace?: boolean;
}

export interface DoubleElimOptions {
  /** How many places to wrestle for. Default 6. */
  places?: 4 | 6 | 8;
  /** Wrestle for true second when the 3rd place winner hasn't already lost to the runner-up. */
  trueSecond?: boolean;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Smallest power of two >= n (min 2). */
export function bracketSizeFor(n: number): number {
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

/**
 * Seed number on each first-round line, top to bottom, so the top seeds are
 * spread apart: 1 and 2 can only meet in the final, 1-4 in the semis, etc.
 * size 8 -> [1, 8, 4, 5, 2, 7, 3, 6].
 */
export function seedLines(size: number): number[] {
  assertPowerOfTwo(size);
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order.slice(0, size);
}

const winner = (bout: string): SlotSource => ({ kind: "winner", bout });
const loser = (bout: string): SlotSource => ({ kind: "loser", bout });

function championshipLabel(round: number, rounds: number): string {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinal";
  if (fromEnd === 2) return "Quarterfinal";
  return `Championship Round ${round}`;
}

/** Championship side, round by round. Returns bout ids per round. */
function championship(size: number, bouts: BracketBout[]): string[][] {
  const rounds = Math.log2(size);
  const lines = seedLines(size);
  const ids: string[][] = [];
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    const roundIds: string[] = [];
    for (let i = 1; i <= count; i++) {
      const id = `W${r}-${i}`;
      const [top, bottom]: [SlotSource, SlotSource] =
        r === 1
          ? [
              { kind: "seed", seed: lines[2 * (i - 1)]! },
              { kind: "seed", seed: lines[2 * (i - 1) + 1]! },
            ]
          : [winner(ids[r - 2]![2 * (i - 1)]!), winner(ids[r - 2]![2 * (i - 1) + 1]!)];
      bouts.push({
        id,
        section: "championship",
        round: 0,
        label: championshipLabel(r, rounds),
        top,
        bottom,
        ...(r === rounds ? { forPlace: 1 } : {}),
      });
      roundIds.push(id);
    }
    ids.push(roundIds);
  }
  return ids;
}

export function singleElimination(size: number, options: SingleElimOptions = {}): Bracket {
  assertPowerOfTwo(size);
  const bouts: BracketBout[] = [];
  const champ = championship(size, bouts);
  if (options.thirdPlace && size >= 4) {
    const semis = champ[champ.length - 2]!;
    bouts.push({
      id: "P3",
      section: "placement",
      round: 0,
      label: "3rd Place",
      top: loser(semis[0]!),
      bottom: loser(semis[1]!),
      forPlace: 3,
    });
  }
  return finish({ format: "single-elim", size, bouts });
}

export function doubleElimination(size: number, options: DoubleElimOptions = {}): Bracket {
  assertPowerOfTwo(size);
  if (size < 4) throw new RangeError("Double elimination needs a bracket of at least 4");
  const places = Math.min(options.places ?? 6, size);
  const bouts: BracketBout[] = [];
  const champ = championship(size, bouts);
  const k = champ.length;
  let consiRound = 0;

  const consiBout = (i: number, top: SlotSource, bottom: SlotSource): string => {
    const id = `L${consiRound}-${i}`;
    bouts.push({ id, section: "consolation", round: 0, label: `Consolation Round ${consiRound}`, top, bottom });
    return id;
  };

  // Consolation round 1: first-round losers pair up.
  consiRound++;
  const firstLosers = champ[0]!.map(loser);
  let current: string[] = [];
  for (let i = 0; i < firstLosers.length / 2; i++) {
    current.push(consiBout(i + 1, firstLosers[2 * i]!, firstLosers[2 * i + 1]!));
  }
  let lastDropIn = current; // with a 4-man bracket, consolation round 1 is the 3rd place bout
  let beforeLastDropIn: string[] = [];

  // For each championship round before the final: its losers drop in, crossed
  // over (top-half losers meet bottom-half wrestlebacks), then winners pair up.
  for (let r = 2; r <= k - 1; r++) {
    const drops = champ[r - 1]!.map(loser);
    beforeLastDropIn = current;
    consiRound++;
    const m = drops.length;
    current = current.map((id, i) => consiBout(i + 1, winner(id), drops[m - 1 - i]!));
    lastDropIn = current;
    if (r < k - 1) {
      consiRound++;
      const paired: string[] = [];
      for (let i = 0; i < current.length / 2; i++) {
        paired.push(consiBout(i + 1, winner(current[2 * i]!), winner(current[2 * i + 1]!)));
      }
      current = paired;
    }
  }

  // 3rd place: in a 4-man bracket it's the single consolation bout; otherwise
  // the two consolation semifinal winners.
  if (k === 2) {
    const third = bouts.find((b) => b.id === lastDropIn[0])!;
    Object.assign(third, { section: "placement", label: "3rd Place", forPlace: 3 });
  } else {
    bouts.push(placementBout("P3", "3rd Place", 3, winner(lastDropIn[0]!), winner(lastDropIn[1]!)));
    if (places >= 6) {
      bouts.push(placementBout("P5", "5th Place", 5, loser(lastDropIn[0]!), loser(lastDropIn[1]!)));
    }
    if (places >= 8 && beforeLastDropIn.length === 2) {
      bouts.push(placementBout("P7", "7th Place", 7, loser(beforeLastDropIn[0]!), loser(beforeLastDropIn[1]!)));
    }
  }

  if (options.trueSecond) {
    const final = champ[k - 1]![0]!;
    const third = k === 2 ? lastDropIn[0]! : "P3";
    bouts.push({
      ...placementBout("TS", "True Second", 2, loser(final), winner(third)),
      conditional: "true-second",
    });
  }

  return finish({ format: "double-elim", size, bouts });
}

function placementBout(id: string, label: string, place: number, top: SlotSource, bottom: SlotSource): BracketBout {
  return { id, section: "placement", round: 0, label, top, bottom, forPlace: place };
}

/**
 * Assign rounds: a bout's round is one more than the latest bout feeding it,
 * except placement bouts (and the final), which all go in the last session.
 */
function finish(bracket: Bracket): Bracket {
  const byId = new Map(bracket.bouts.map((b) => [b.id, b]));
  const depth = new Map<string, number>();
  const roundOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const b = byId.get(id)!;
    const feeders = [b.top, b.bottom].filter((s) => s.kind !== "seed").map((s) => roundOf((s as { bout: string }).bout));
    const d = 1 + Math.max(0, ...feeders);
    depth.set(id, d);
    return d;
  };
  for (const b of bracket.bouts) b.round = roundOf(b.id);
  const isFinals = (b: BracketBout) => b.forPlace !== undefined && b.conditional === undefined;
  const lastRound = Math.max(...bracket.bouts.filter(isFinals).map((b) => b.round));
  for (const b of bracket.bouts) {
    if (isFinals(b)) b.round = lastRound;
    if (b.conditional) b.round = lastRound + 1;
  }
  return bracket;
}

// ---------------------------------------------------------------------------
// Draw (who goes on which seed line)
// ---------------------------------------------------------------------------

export interface DrawEntrant {
  id: string;
  team?: string;
}

export interface DrawOptions {
  /** Seeded wrestler ids, best first. Everyone else is drawn randomly. */
  seeds?: string[];
  /** Bracket size; defaults to the smallest that fits. */
  size?: number;
  /** Random number source in [0, 1). Pass a seeded one for repeatable draws. */
  random?: () => number;
  /** How many random draws to try when keeping teammates apart. Default 200. */
  attempts?: number;
}

/**
 * Returns wrestler ids indexed by seed number - 1; `null` means a bye. Top
 * seeds get the byes (standard seed lines spread them across the bracket).
 * Unseeded wrestlers are drawn at random, keeping teammates from meeting
 * early where possible.
 */
export function drawBracket(entrants: DrawEntrant[], options: DrawOptions = {}): (string | null)[] {
  const ids = new Set(entrants.map((e) => e.id));
  if (ids.size !== entrants.length) throw new Error("Duplicate wrestler in draw");
  const seeded = options.seeds ?? [];
  for (const s of seeded) if (!ids.has(s)) throw new Error(`Seeded wrestler ${s} isn't entered`);
  const size = options.size ?? bracketSizeFor(entrants.length);
  if (size < entrants.length) throw new RangeError(`Bracket of ${size} is too small for ${entrants.length} wrestlers`);
  assertPowerOfTwo(size);

  const random = options.random ?? Math.random;
  const team = new Map(entrants.map((e) => [e.id, e.team]));
  const unseeded = entrants.map((e) => e.id).filter((id) => !seeded.includes(id));
  const lines = seedLines(size);
  const lineOfSeed = new Map(lines.map((seed, line) => [seed, line]));
  const rounds = Math.log2(size);

  const conflictScore = (draw: (string | null)[]): number => {
    let score = 0;
    for (let a = 0; a < draw.length; a++) {
      for (let b = a + 1; b < draw.length; b++) {
        const ta = draw[a] && team.get(draw[a]!);
        if (!ta || ta !== (draw[b] && team.get(draw[b]!))) continue;
        // Round in which lines a and b would first meet: the earlier, the worse.
        const meet = Math.floor(Math.log2(lineOfSeed.get(a + 1)! ^ lineOfSeed.get(b + 1)!)) + 1;
        score += (rounds + 1 - meet) ** 2;
      }
    }
    return score;
  };

  let best: (string | null)[] = [];
  let bestScore = Infinity;
  for (let attempt = 0; attempt < (options.attempts ?? 200); attempt++) {
    const shuffled = shuffle(unseeded, random);
    const draw = [...seeded, ...shuffled, ...new Array<null>(size - entrants.length).fill(null)];
    const score = conflictScore(draw);
    if (score < bestScore) {
      best = draw;
      bestScore = score;
      if (score === 0) break;
    }
  }
  return best;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Small seeded PRNG (mulberry32) for repeatable draws and tests. */
export function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Resolution: who is in each bout, byes, placements
// ---------------------------------------------------------------------------

export const BYE = "BYE" as const;
/** A wrestler id, a bye, or null when not known yet. */
export type Participant = string | null;

export type BoutStatus =
  | "waiting" // at least one wrestler not known yet
  | "ready" // both wrestlers known, not wrestled
  | "done"
  | "bye" // one side is a bye: no match, the other wrestler advances
  | "not-needed"; // conditional bout that doesn't have to be wrestled

export interface ResolvedBout {
  bout: BracketBout;
  top: Participant;
  bottom: Participant;
  status: BoutStatus;
  winner: Participant;
  loser: Participant;
  /** Set when a recorded result no longer fits (e.g. an earlier result was corrected). */
  conflict?: string;
}

export interface BracketResult {
  winner: string;
}

export interface ResolvedBracket {
  bouts: ResolvedBout[];
  /** place -> wrestler id, for places decided so far. */
  placements: Map<number, string>;
  conflicts: ResolvedBout[];
}

/**
 * Work out every bout from the draw and the results so far. Pure: call it
 * again after any result or correction. A corrected result that changes who
 * advanced shows up as a conflict on any later bout that was already
 * wrestled by the wrong wrestler.
 */
export function resolveBracket(
  bracket: Bracket,
  draw: (string | null)[],
  results: Record<string, BracketResult> = {},
): ResolvedBracket {
  const byId = new Map(bracket.bouts.map((b) => [b.id, b]));
  const resolved = new Map<string, ResolvedBout>();

  const source = (s: SlotSource): Participant => {
    if (s.kind === "seed") return draw[s.seed - 1] ?? BYE;
    const r = resolve(s.bout);
    return s.kind === "winner" ? r.winner : r.loser;
  };

  const resolve = (id: string): ResolvedBout => {
    const done = resolved.get(id);
    if (done) return done;
    const bout = byId.get(id);
    if (!bout) throw new Error(`Unknown bout ${id}`);
    const top = source(bout.top);
    const bottom = source(bout.bottom);
    const result = results[id];
    let r: ResolvedBout;

    if (top === BYE && bottom === BYE) {
      r = { bout, top, bottom, status: "bye", winner: BYE, loser: BYE };
    } else if (top === BYE || bottom === BYE) {
      r = { bout, top, bottom, status: "bye", winner: top === BYE ? bottom : top, loser: BYE };
    } else if (top === null || bottom === null) {
      r = { bout, top, bottom, status: "waiting", winner: null, loser: null };
      if (result) r.conflict = "A result is recorded but both wrestlers aren't known yet.";
    } else if (bout.conditional === "true-second" && haveMet(top, bottom, id)) {
      r = { bout, top, bottom, status: "not-needed", winner: null, loser: null };
    } else if (result && (result.winner === top || result.winner === bottom)) {
      r = { bout, top, bottom, status: "done", winner: result.winner, loser: result.winner === top ? bottom : top };
    } else {
      r = { bout, top, bottom, status: "ready", winner: null, loser: null };
      if (result) r.conflict = `Recorded winner ${result.winner} isn't in this bout anymore (${top} vs ${bottom}).`;
    }
    resolved.set(id, r);
    return r;
  };

  const haveMet = (a: string, b: string, except: string): boolean =>
    bracket.bouts.some((other) => {
      if (other.id === except || other.conditional) return false;
      const r = resolve(other.id);
      return r.status === "done" && ((r.top === a && r.bottom === b) || (r.top === b && r.bottom === a));
    });

  const bouts = bracket.bouts.map((b) => resolve(b.id));

  const placements = new Map<number, string>();
  for (const r of bouts) {
    if (r.bout.forPlace === undefined || r.bout.conditional) continue;
    if (r.winner && r.winner !== BYE && (r.status === "done" || r.status === "bye")) placements.set(r.bout.forPlace, r.winner);
    if (r.loser && r.loser !== BYE && r.status === "done") placements.set(r.bout.forPlace + 1, r.loser);
  }
  const trueSecond = bouts.find((r) => r.bout.conditional === "true-second");
  if (trueSecond?.status === "done") {
    placements.set(2, trueSecond.winner!);
    placements.set(3, trueSecond.loser!);
  } else if (trueSecond && trueSecond.status !== "not-needed") {
    // 2nd and 3rd aren't final until the true-second bout is settled.
    placements.delete(2);
    placements.delete(3);
  }

  return { bouts, placements, conflicts: bouts.filter((b) => b.conflict) };
}

/**
 * The real (non-bye) bouts whose wrestler feeds into this bout, looking
 * through byes. Used to enforce rest between a wrestler's matches.
 */
export function feedingBouts(resolved: ResolvedBracket, boutId: string): string[] {
  const byId = new Map(resolved.bouts.map((r) => [r.bout.id, r]));
  const feeders = (id: string): string[] => {
    const r = byId.get(id);
    if (!r) throw new Error(`Unknown bout ${id}`);
    return [r.bout.top, r.bout.bottom].flatMap((s) => {
      if (s.kind === "seed") return [];
      const f = byId.get(s.bout)!;
      if (f.status === "not-needed") return [];
      if (f.status === "bye") return s.kind === "winner" ? feeders(f.bout.id) : [];
      return [f.bout.id];
    });
  };
  return feeders(boutId);
}

function assertPowerOfTwo(size: number): void {
  if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
    throw new RangeError(`Bracket size must be a power of 2 (2, 4, 8, 16...), got ${size}`);
  }
}
