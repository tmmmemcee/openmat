/**
 * Live bout scoring as an append-only event log.
 *
 * The table records what happens (takedown, penalty, ...). The score is never
 * stored; it's always computed from the log with `boutState`. Undo and
 * corrections are new "void" events that cancel an earlier event, so nothing
 * is ever erased and every change is auditable (who, when, why). A void can
 * itself be voided to restore the original event.
 *
 * `finalizeBout` turns the log plus how the bout ended into an official
 * result: winner, win type, team points, and the score-sheet text
 * ("Dec 8-3", "TF 18-2 (5:19)", "F 1:36", "VPO1 5-3").
 */

import type { Corner, Ruleset, WinType } from "./rulesets.js";

interface EventMeta {
  id: string;
  /** Period the event happened in (1-based; overtime periods continue the count). */
  period?: number;
  /** Seconds of wrestling elapsed in the match when it happened. */
  matchTimeSec?: number;
  /** When and by whom it was entered, and why (for corrections). */
  at?: string;
  by?: string;
  reason?: string;
}

export type BoutEvent = EventMeta &
  (
    | { type: "score"; corner: Corner; action: string }
    /** `corner` is the offender. `points` overrides the progression (UWW: 2-point cautions). */
    | { type: "penalty"; corner: Corner; kind: string; points?: number }
    /** Net riding time advantage so far, for `corner` (NCAA). The latest entry counts. */
    | { type: "riding-time"; corner: Corner; seconds: number }
    | { type: "void"; target: string }
  );

export interface ScoreLine {
  eventId: string;
  /** Who got the points. */
  corner: Corner;
  points: number;
  code: string;
  label: string;
  technical: boolean;
  period?: number;
  matchTimeSec?: number;
}

export interface BoutState {
  score: Record<Corner, number>;
  /** Points from wrestling actions only (UWW win types and tie criteria). */
  technicalPoints: Record<Corner, number>;
  /** Every active point-scoring entry, in order. */
  lines: ScoreLine[];
  /** Penalty counts per offender, by progression group. */
  penaltyCounts: Record<Corner, Record<string, number>>;
  cautions: Record<Corner, number>;
  /** Warnings (0-point steps), e.g. first stalling call. */
  warnings: { eventId: string; corner: Corner; kind: string }[];
  /** A corner disqualified by the penalty progression. */
  disqualified?: Corner;
  /** UWW: a corner that reached the caution limit (loses). */
  cautionedOut?: Corner;
  ridingAdvantage?: { corner: Corner; seconds: number };
  /** First moment the lead reached the tech fall margin. */
  techFall?: { winner: Corner; eventId: string };
  /** Entries that couldn't be scored (unknown action, bad void...). */
  errors: string[];
}

const other = (c: Corner): Corner => (c === "A" ? "B" : "A");

/** Compute the current state of a bout from its event log. */
export function boutState(ruleset: Ruleset, events: BoutEvent[]): BoutState {
  const active = activeEvents(events);
  const state: BoutState = {
    score: { A: 0, B: 0 },
    technicalPoints: { A: 0, B: 0 },
    lines: [],
    penaltyCounts: { A: {}, B: {} },
    cautions: { A: 0, B: 0 },
    warnings: [],
    errors: [...active.errors],
  };
  const actions = new Map(ruleset.actions.map((a) => [a.code, a]));
  const penalties = new Map(ruleset.penalties.map((p) => [p.kind, p]));

  const addLine = (line: ScoreLine) => {
    state.lines.push(line);
    state.score[line.corner] += line.points;
    if (line.technical) state.technicalPoints[line.corner] += line.points;
    const lead = state.score[line.corner] - state.score[other(line.corner)];
    if (!state.techFall && lead >= ruleset.techFallMargin) state.techFall = { winner: line.corner, eventId: line.eventId };
  };

  for (const e of active.events) {
    const where = { period: e.period, matchTimeSec: e.matchTimeSec };
    if (e.type === "score") {
      const action = actions.get(e.action);
      if (!action) {
        state.errors.push(`Event ${e.id}: "${e.action}" isn't a scoring action in ${ruleset.name}.`);
        continue;
      }
      addLine({ eventId: e.id, corner: e.corner, points: action.points, code: action.code, label: action.label, technical: action.technical, ...where });
    } else if (e.type === "penalty") {
      const p = penalties.get(e.kind);
      if (!p) {
        state.errors.push(`Event ${e.id}: "${e.kind}" isn't a penalty in ${ruleset.name}.`);
        continue;
      }
      const group = [p.kind, ...(p.sharedWith ?? [])].sort().join("+");
      const counts = state.penaltyCounts[e.corner];
      const n = (counts[group] ?? 0) + 1;
      counts[group] = n;
      if (p.kind === "caution") {
        state.cautions[e.corner]++;
        if (ruleset.cautionsToLose && state.cautions[e.corner] >= ruleset.cautionsToLose && !state.cautionedOut) {
          state.cautionedOut = e.corner;
        }
      }
      const step = p.steps[Math.min(n, p.steps.length) - 1]!;
      if (step === "DQ") {
        state.disqualified ??= e.corner;
        continue;
      }
      const points = e.points ?? step;
      if (points === 0) {
        state.warnings.push({ eventId: e.id, corner: e.corner, kind: p.kind });
        continue;
      }
      addLine({
        eventId: e.id,
        corner: other(e.corner),
        points,
        code: p.kind === "caution" ? `0/${points}` : `P${points}`,
        label: `${p.label} (${ordinal(n)})`,
        technical: false,
        ...where,
      });
    } else if (e.type === "riding-time") {
      state.ridingAdvantage = { corner: e.corner, seconds: e.seconds };
    }
  }
  return state;
}

/** Events still in effect after voids (and voids of voids) are applied. */
function activeEvents(events: BoutEvent[]): { events: Exclude<BoutEvent, { type: "void" }>[]; errors: string[] } {
  const byId = new Map(events.map((e) => [e.id, e]));
  const errors: string[] = [];
  if (byId.size !== events.length) errors.push("Duplicate event ids in the bout log.");
  const voiders = new Map<string, string[]>();
  for (const e of events) {
    if (e.type !== "void") continue;
    if (!byId.has(e.target)) errors.push(`Void ${e.id} points at unknown event ${e.target}.`);
    voiders.set(e.target, [...(voiders.get(e.target) ?? []), e.id]);
  }
  const memo = new Map<string, boolean>();
  const isActive = (id: string): boolean => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, true); // guards against void cycles
    const result = !(voiders.get(id) ?? []).some(isActive);
    memo.set(id, result);
    return result;
  };
  return {
    events: events.filter((e): e is Exclude<BoutEvent, { type: "void" }> => e.type !== "void" && isActive(e.id)),
    errors,
  };
}

// ---------------------------------------------------------------------------
// Finishing a bout
// ---------------------------------------------------------------------------

export type BoutEnding =
  /** Time ran out (after overtime, if any). */
  | { type: "time" }
  | { type: "tech-fall" }
  | { type: "fall"; winner: Corner; matchTimeSec?: number }
  | { type: "injury-default" | "disqualification" | "forfeit" | "medical-forfeit"; winner: Corner; matchTimeSec?: number };

export interface BoutOutcome {
  winner: Corner;
  winType: WinType;
  /** Final score, including any riding time point. */
  score: Record<Corner, number>;
  teamPoints: number;
  /** UWW classification points [winner, loser]. */
  classificationPoints?: [number, number];
  /** Score-sheet text, winner's score first: "Dec 8-3", "TF 18-2 (5:19)", "F 1:36". */
  summary: string;
  /** UWW: which tie criterion decided a tied bout. */
  decidedBy?: "highest-value" | "most-highest-value" | "fewest-cautions" | "last-technical-point";
}

export type FinalizeResult =
  | { ok: true; outcome: BoutOutcome }
  | { ok: false; reason: "tied" | "no-tech-fall" | "unresolved-tie"; message: string };

export function finalizeBout(ruleset: Ruleset, events: BoutEvent[], ending: BoutEnding): FinalizeResult {
  const state = boutState(ruleset, events);
  const uww = ruleset.tieBreak === "uww-criteria";
  const lastTime = Math.max(0, ...state.lines.map((l) => l.matchTimeSec ?? 0));

  // Riding time point (NCAA), awarded at the end of the match.
  const score = { ...state.score };
  const riding = state.ridingAdvantage;
  if (ruleset.ridingTimePointSec && riding && riding.seconds >= ruleset.ridingTimePointSec) score[riding.corner] += 1;
  const leader: Corner | undefined = score.A > score.B ? "A" : score.B > score.A ? "B" : undefined;
  const margin = Math.abs(score.A - score.B);

  const outcome = (winner: Corner, winType: WinType, summary: string, extra: Partial<BoutOutcome> = {}): FinalizeResult => {
    const cp = ruleset.classificationPoints?.[winType];
    return {
      ok: true,
      outcome: {
        winner,
        winType,
        score,
        teamPoints: ruleset.teamPoints[winType] ?? 0,
        ...(cp ? { classificationPoints: cp } : {}),
        summary,
        ...extra,
      },
    };
  };
  const scoreText = (winner: Corner) => `${score[winner]}-${score[other(winner)]}`;

  // Penalties that end the bout take precedence over how the table ended it.
  if (state.disqualified) return outcome(other(state.disqualified), uww ? "DSQ" : "DQ", uww ? "DSQ" : "DQ");
  if (state.cautionedOut) return outcome(other(state.cautionedOut), "VCA", `VCA ${scoreText(other(state.cautionedOut))}`);

  switch (ending.type) {
    case "fall": {
      const t = ending.matchTimeSec;
      return uww ? outcome(ending.winner, "VFA", "VFA") : outcome(ending.winner, "FALL", t !== undefined ? `F ${clock(t)}` : "F");
    }
    case "forfeit":
      return outcome(ending.winner, uww ? "VFO" : "FOR", uww ? "VFO" : "For.");
    case "medical-forfeit":
      return outcome(ending.winner, uww ? "VFO" : "MFF", uww ? "VFO" : "M. For.");
    case "injury-default": {
      const t = ending.matchTimeSec;
      return uww ? outcome(ending.winner, "VIN", "VIN") : outcome(ending.winner, "INJ", t !== undefined ? `Inj. ${clock(t)}` : "Inj.");
    }
    case "disqualification":
      return outcome(ending.winner, uww ? "DSQ" : "DQ", uww ? "DSQ" : "DQ");
    case "tech-fall": {
      if (!leader || margin < ruleset.techFallMargin) {
        return { ok: false, reason: "no-tech-fall", message: `The lead is ${margin}; a technical fall needs ${ruleset.techFallMargin}.` };
      }
      return techFall(leader);
    }
    case "time":
      break;
  }

  function techFall(winner: Corner): FinalizeResult {
    if (uww) {
      const type = state.technicalPoints[other(winner)] > 0 ? "VSU1" : "VSU";
      return outcome(winner, type, `${type} ${scoreText(winner)}`);
    }
    return outcome(winner, "TF", `TF ${scoreText(winner)} (${clock(lastTime)})`);
  }

  // Time expired.
  if (leader && margin >= ruleset.techFallMargin) return techFall(leader);
  if (leader) {
    if (uww) {
      const type = state.technicalPoints[other(leader)] > 0 ? "VPO1" : "VPO";
      return outcome(leader, type, `${type} ${scoreText(leader)}`);
    }
    const major = ruleset.majorDecisionMargin !== undefined && margin >= ruleset.majorDecisionMargin;
    return outcome(leader, major ? "MD" : "DEC", `${major ? "MD" : "Dec"} ${scoreText(leader)}`);
  }

  // Tied.
  if (!uww) {
    return { ok: false, reason: "tied", message: `Tied ${score.A}-${score.B}. Overtime: ${ruleset.overtime ?? "see rules"}` };
  }
  const decided = uwwCriteria(state);
  if (!decided) {
    return { ok: false, reason: "unresolved-tie", message: "Tied and the criteria can't separate the wrestlers; the mat chairman decides." };
  }
  const type = state.technicalPoints[other(decided.winner)] > 0 ? "VPO1" : "VPO";
  return outcome(decided.winner, type, `${type} ${scoreText(decided.winner)}`, { decidedBy: decided.by });
}

/**
 * UWW tie criteria, in order: highest-value hold, most holds of that value,
 * fewest cautions, last technical point scored.
 */
function uwwCriteria(state: BoutState): { winner: Corner; by: NonNullable<BoutOutcome["decidedBy"]> } | undefined {
  const technical = state.lines.filter((l) => l.technical);
  const best = (c: Corner) => Math.max(0, ...technical.filter((l) => l.corner === c).map((l) => l.points));
  if (best("A") !== best("B")) return { winner: best("A") > best("B") ? "A" : "B", by: "highest-value" };
  const top = best("A");
  if (top > 0) {
    const count = (c: Corner) => technical.filter((l) => l.corner === c && l.points === top).length;
    if (count("A") !== count("B")) return { winner: count("A") > count("B") ? "A" : "B", by: "most-highest-value" };
  }
  if (state.cautions.A !== state.cautions.B) {
    return { winner: state.cautions.A < state.cautions.B ? "A" : "B", by: "fewest-cautions" };
  }
  const last = technical[technical.length - 1];
  return last ? { winner: last.corner, by: "last-technical-point" } : undefined;
}

/** Seconds to "m:ss". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

// ---------------------------------------------------------------------------
// Result-only entry (tables that don't score live)
// ---------------------------------------------------------------------------

export interface ManualResult {
  winner: Corner;
  winType: WinType;
  /** Final score; needed for decisions, majors, tech falls. */
  score?: Record<Corner, number>;
  /** Match time of a fall, injury default or tech fall. */
  matchTimeSec?: number;
}

const SCORED: WinType[] = ["DEC", "MD", "TF", "VPO", "VPO1", "VSU", "VSU1"];

/** Check a hand-entered result against the rules and produce the official outcome. */
export function manualOutcome(ruleset: Ruleset, r: ManualResult): FinalizeResult {
  const fail = (message: string): FinalizeResult => ({ ok: false, reason: "unresolved-tie", message });
  if (!(r.winType in ruleset.teamPoints)) return fail(`${r.winType} isn't a result type in ${ruleset.name}.`);
  const score = r.score ?? { A: 0, B: 0 };
  const loser = other(r.winner);
  const margin = score[r.winner] - score[loser];

  if (SCORED.includes(r.winType)) {
    if (!r.score) return fail("Enter the final score.");
    if (margin <= 0) return fail("The winner needs the higher score.");
    const tf = ruleset.techFallMargin;
    const major = ruleset.majorDecisionMargin ?? Infinity;
    if (r.winType === "DEC" && margin >= major) return fail(`A ${margin}-point win is a major decision.`);
    if (r.winType === "MD" && (margin < major || margin >= tf)) return fail(`A major decision is a ${major}-${tf - 1} point win.`);
    if ((r.winType === "TF" || r.winType === "VSU" || r.winType === "VSU1") && margin < tf) return fail(`A technical fall needs a ${tf}-point lead.`);
    if ((r.winType === "VPO" || r.winType === "VSU") && score[loser] > 0) return fail(`${r.winType} means the loser didn't score; use ${r.winType}1.`);
    if ((r.winType === "VPO1" || r.winType === "VSU1") && score[loser] === 0) return fail(`The loser didn't score; use ${r.winType.slice(0, 3)}.`);
    if ((r.winType === "DEC" || r.winType === "VPO" || r.winType === "VPO1") && margin >= tf) return fail(`A ${margin}-point lead is a technical fall.`);
  }

  const t = r.matchTimeSec;
  const text = `${score[r.winner]}-${score[loser]}`;
  const summaries: Partial<Record<WinType, string>> = {
    DEC: `Dec ${text}`,
    MD: `MD ${text}`,
    TF: `TF ${text}${t !== undefined ? ` (${clock(t)})` : ""}`,
    FALL: t !== undefined ? `F ${clock(t)}` : "F",
    FOR: "For.",
    INJ: t !== undefined ? `Inj. ${clock(t)}` : "Inj.",
    DQ: "DQ",
    MFF: "M. For.",
    VPO: `VPO ${text}`,
    VPO1: `VPO1 ${text}`,
    VSU: `VSU ${text}`,
    VSU1: `VSU1 ${text}`,
  };
  const cp = ruleset.classificationPoints?.[r.winType];
  return {
    ok: true,
    outcome: {
      winner: r.winner,
      winType: r.winType,
      score,
      teamPoints: ruleset.teamPoints[r.winType] ?? 0,
      ...(cp ? { classificationPoints: cp } : {}),
      summary: summaries[r.winType] ?? r.winType,
    },
  };
}
