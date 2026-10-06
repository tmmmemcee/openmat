/**
 * Youth scratch duals and tri-meets: no brackets, just fair one-off matches
 * between kids on different teams, made from each team's latest weights.
 *
 * Every kid should get the same number of matches (the director picks it).
 * Pairs must be within a weight and age limit; when both kids' experience
 * ratings are close, a little more weight and age difference is allowed,
 * since an evenly matched kid a bit heavier or older is still a fair match.
 *
 * Pairing is greedy, one "round" at a time so everyone gets a first match
 * before anyone gets a second: the kid with the fewest possible opponents
 * picks first, and takes the closest of them.
 */

export interface MeetWrestler {
  id: string;
  team: string;
  /** Weigh-in weight, or the latest weight the coach supplied. */
  weight: number;
  /** Age in years (from birth year), when known. */
  age: number | null;
  gender?: "boys" | "girls" | null;
  /** Private experience rating, when the kid came from a saved roster. */
  skill?: number;
}

export interface MeetOptions {
  /** Matches each kid should get. */
  matchesPerKid: number;
  /** Heaviest may be at most this % over the lighter. */
  maxWeightPct: number;
  /** At most this many years apart. */
  maxAgeGap: number;
  /** Ratings this close count as "evenly matched"... */
  similarSkill: number;
  /** ...and then allow this much more weight difference (percentage points)... */
  skillWeightBonusPct: number;
  /** ...and this many more years. */
  skillAgeBonus: number;
  /** Let girls wrestle boys. */
  mixGenders: boolean;
}

export const DEFAULT_MEET_OPTIONS: MeetOptions = {
  matchesPerKid: 2,
  maxWeightPct: 10,
  maxAgeGap: 2,
  similarSkill: 100,
  skillWeightBonusPct: 5,
  skillAgeBonus: 1,
  mixGenders: false,
};

export interface PairCheck {
  ok: boolean;
  /** How much heavier the heavier kid is, in % of the lighter. */
  weightPct: number;
  ageGap: number | null;
  skillGap: number | null;
  /** Things the director should glance at. Empty for a comfortable match. */
  flags: string[];
  /** Why the pair isn't allowed (when !ok). */
  reason?: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Is this a fair match under the meet's limits, and what's worth flagging? */
export function checkPair(x: MeetWrestler, y: MeetWrestler, opts: MeetOptions = DEFAULT_MEET_OPTIONS): PairCheck {
  const light = Math.min(x.weight, y.weight);
  const weightPct = round1(((Math.max(x.weight, y.weight) - light) / light) * 100);
  const ageGap = x.age != null && y.age != null ? Math.abs(x.age - y.age) : null;
  const skillGap = x.skill != null && y.skill != null ? Math.round(Math.abs(x.skill - y.skill)) : null;
  const evenlyMatched = skillGap != null && skillGap <= opts.similarSkill;
  const weightLimit = opts.maxWeightPct + (evenlyMatched ? opts.skillWeightBonusPct : 0);
  const ageLimit = opts.maxAgeGap + (evenlyMatched ? opts.skillAgeBonus : 0);

  const flags: string[] = [];
  let reason: string | undefined;
  if (x.team === y.team) reason = "Same team";
  else if (!opts.mixGenders && x.gender && y.gender && x.gender !== y.gender) reason = "Boy vs girl";
  else if (weightPct > weightLimit) reason = `${weightPct}% apart in weight (limit ${weightLimit}%)`;
  else if (ageGap != null && ageGap > ageLimit) reason = `${ageGap} years apart (limit ${ageLimit})`;

  if (x.team === y.team) flags.push("same team");
  if (x.gender && y.gender && x.gender !== y.gender) flags.push("boy vs girl");
  if (weightPct > opts.maxWeightPct) flags.push(`${weightPct}% weight gap (evenly matched)`);
  else if (weightPct > opts.maxWeightPct * 0.7) flags.push(`${weightPct}% weight gap`);
  if (ageGap != null && ageGap > opts.maxAgeGap) flags.push(`${ageGap} years apart (evenly matched)`);
  else if (ageGap != null && ageGap === opts.maxAgeGap && ageGap > 0) flags.push(`${ageGap} years apart`);
  if (skillGap != null && skillGap > 250) flags.push("experience gap");

  return { ok: !reason, weightPct, ageGap, skillGap, flags, ...(reason ? { reason } : {}) };
}

/** Lower is a better match. */
function cost(c: PairCheck, opts: MeetOptions): number {
  return c.weightPct / opts.maxWeightPct + (c.ageGap ?? 0) / Math.max(opts.maxAgeGap, 1) / 2 + (c.skillGap ?? 0) / 400;
}

export interface MeetPairing extends PairCheck {
  a: string;
  b: string;
  /** 1 for each kid's first match, 2 for their second... (scheduling order). */
  round: number;
}

export interface MeetResult {
  pairings: MeetPairing[];
  /** Kids who got fewer matches than asked for, and why. */
  short: { id: string; matches: number; reason: string }[];
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Make the meet's matches. `existing` pairs (already wrestled, or made by
 * hand) are kept: they count toward each kid's matches and aren't repeated.
 */
export function pairMeet(wrestlers: MeetWrestler[], options: Partial<MeetOptions> = {}, existing: [string, string][] = []): MeetResult {
  const opts = { ...DEFAULT_MEET_OPTIONS, ...options };
  const byId = new Map(wrestlers.map((w) => [w.id, w]));
  const count = new Map(wrestlers.map((w) => [w.id, 0]));
  const used = new Set<string>();
  for (const [a, b] of existing) {
    used.add(pairKey(a, b));
    if (count.has(a)) count.set(a, count.get(a)! + 1);
    if (count.has(b)) count.set(b, count.get(b)! + 1);
  }

  // Allowed opponents for everyone, closest first. Computed once.
  const options_ = new Map<string, { id: string; check: PairCheck; cost: number }[]>();
  for (const w of wrestlers) {
    const list = [];
    for (const o of wrestlers) {
      if (o.id === w.id) continue;
      const check = checkPair(w, o, opts);
      if (check.ok) list.push({ id: o.id, check, cost: cost(check, opts) });
    }
    options_.set(w.id, list.sort((p, q) => p.cost - q.cost || byId.get(p.id)!.weight - byId.get(q.id)!.weight));
  }

  const pairings: MeetPairing[] = [];
  const open = (id: string, below: number) => count.get(id)! < below;
  for (let round = 1; round <= opts.matchesPerKid; round++) {
    for (;;) {
      // Who still needs a match this round, and who could they wrestle?
      let pick: { id: string; choices: { id: string; check: PairCheck; cost: number }[] } | null = null;
      for (const w of wrestlers) {
        if (!open(w.id, round)) continue;
        const choices = options_.get(w.id)!.filter((o) => open(o.id, round) && !used.has(pairKey(w.id, o.id)));
        if (!choices.length) continue;
        // Fewest options first; on a tie, whoever's best option is worst (hardest to place).
        if (
          !pick ||
          choices.length < pick.choices.length ||
          (choices.length === pick.choices.length && choices[0]!.cost > pick.choices[0]!.cost)
        ) {
          pick = { id: w.id, choices };
        }
      }
      if (!pick) break;
      const best = pick.choices[0]!;
      used.add(pairKey(pick.id, best.id));
      count.set(pick.id, count.get(pick.id)! + 1);
      count.set(best.id, count.get(best.id)! + 1);
      pairings.push({ a: pick.id, b: best.id, round, ...best.check });
    }
  }

  const short = wrestlers
    .filter((w) => count.get(w.id)! < opts.matchesPerKid)
    .map((w) => {
      const n = count.get(w.id)!;
      const possible = options_.get(w.id)!;
      const reason = !possible.length
        ? `No one on another team within ${opts.maxWeightPct}% and ${opts.maxAgeGap} years`
        : possible.every((o) => used.has(pairKey(w.id, o.id)))
          ? `Already wrestling everyone close enough (${possible.length})`
          : "Everyone close enough already has their matches";
      return { id: w.id, matches: n, reason };
    });
  return { pairings, short };
}

export interface MeetBoutResult {
  /** Teams of the two wrestlers. */
  teamA: string;
  teamB: string;
  winnerTeam: string;
  /** Team points the result is worth (decision 3, major 4, tech fall 5, fall 6...). */
  teamPoints: number;
}

export interface MeetTeamScore {
  team: string;
  points: number;
  wins: number;
  losses: number;
}

/** Score between two teams (a dual inside a tri-meet, or the whole dual). */
export interface DualScore {
  teams: [string, string];
  points: [number, number];
  bouts: number;
}

/** Dual-meet style scoring: each win earns its team the result's team points. */
export function meetScores(results: MeetBoutResult[]): { teams: MeetTeamScore[]; duals: DualScore[] } {
  const teams = new Map<string, MeetTeamScore>();
  const duals = new Map<string, DualScore>();
  const team = (name: string) => teams.get(name) ?? teams.set(name, { team: name, points: 0, wins: 0, losses: 0 }).get(name)!;
  for (const r of results) {
    if (r.teamA === r.teamB) continue;
    const loserTeam = r.winnerTeam === r.teamA ? r.teamB : r.teamA;
    const w = team(r.winnerTeam);
    w.points += r.teamPoints;
    w.wins++;
    team(loserTeam).losses++;
    const pair = [r.teamA, r.teamB].sort() as [string, string];
    const key = pair.join("\u0000");
    const dual = duals.get(key) ?? duals.set(key, { teams: pair, points: [0, 0], bouts: 0 }).get(key)!;
    dual.points[pair[0] === r.winnerTeam ? 0 : 1] += r.teamPoints;
    dual.bouts++;
  }
  return {
    teams: [...teams.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.team.localeCompare(b.team)),
    duals: [...duals.values()].sort((a, b) => a.teams.join().localeCompare(b.teams.join())),
  };
}
