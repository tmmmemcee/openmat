/**
 * Team scores for a tournament, NFHS style by default:
 *   - advancement: points for each win in the championship or consolation
 *     bracket (a bye followed by a win counts as a win too);
 *   - bonus: extra points for falls, forfeits, defaults and DQs, tech falls
 *     and major decisions;
 *   - placement: points for where each wrestler finishes.
 * Round robins earn bonus and placement points only. Every number is
 * adjustable because state associations and tournaments differ.
 */
import type { WinType } from "./rulesets.js";

export interface TeamScoring {
  advancement: { championship: number; consolation: number };
  bonus: Partial<Record<WinType, number>>;
  /** Points for 1st, 2nd, 3rd... */
  placePoints: number[];
}

export const NFHS_TEAM_SCORING: TeamScoring = {
  advancement: { championship: 2, consolation: 1 },
  bonus: { FALL: 2, FOR: 2, INJ: 2, DQ: 2, MFF: 2, TF: 1.5, MD: 1, VFA: 2, VFO: 2, VIN: 2, DSQ: 2, VCA: 2, VSU: 1.5, VSU1: 1.5 },
  placePoints: [16, 12, 9, 7, 5, 3, 2, 1],
};

export interface ScoredBout {
  key: string;
  section: "championship" | "consolation" | "placement" | "pool";
  status: "done" | "bye" | string;
  winner: string | null;
  winType?: string | null;
  /** Elimination: the bout this bout's winner goes to. */
  winnerTo?: string | null;
}

export interface ScoredBracket {
  bouts: ScoredBout[];
  places: { place: number; entryId: string }[];
}

export interface TeamScore {
  team: string;
  points: number;
  advancement: number;
  bonus: number;
  placement: number;
  /** Wrestlers who scored points for the team. */
  wrestlers: number;
}

export function teamScores(brackets: ScoredBracket[], teamOf: (entryId: string) => string | undefined, scoring: TeamScoring = NFHS_TEAM_SCORING): TeamScore[] {
  const totals = new Map<string, TeamScore>();
  const wrestlers = new Map<string, Set<string>>();
  const add = (entryId: string | null, field: "advancement" | "bonus" | "placement", points: number) => {
    const team = entryId ? teamOf(entryId)?.trim() : undefined;
    if (!team || !points) return;
    const key = team.toLowerCase();
    if (!wrestlers.has(key)) wrestlers.set(key, new Set());
    wrestlers.get(key)!.add(entryId!);
    const t = totals.get(key) ?? { team, points: 0, advancement: 0, bonus: 0, placement: 0, wrestlers: 0 };
    t[field] += points;
    t.points += points;
    totals.set(key, t);
  };
  const advancementFor = (section: ScoredBout["section"]) =>
    section === "championship" ? scoring.advancement.championship : section === "consolation" ? scoring.advancement.consolation : 0;

  for (const b of brackets) {
    const byKey = new Map(b.bouts.map((x) => [x.key, x]));
    for (const bout of b.bouts) {
      if (bout.status === "done" && bout.winner) {
        // The final and placement bouts earn placement points, not advancement.
        const isLastChampionship = bout.section === "championship" && !bout.winnerTo;
        if (!isLastChampionship) add(bout.winner, "advancement", advancementFor(bout.section));
        add(bout.winner, "bonus", (bout.winType && scoring.bonus[bout.winType as WinType]) || 0);
      }
      // A bye followed by a win counts as a win.
      if (bout.status === "bye" && bout.winner && bout.winnerTo) {
        const next = byKey.get(bout.winnerTo);
        if (next?.status === "done" && next.winner === bout.winner) add(bout.winner, "advancement", advancementFor(bout.section));
      }
    }
    for (const p of b.places) add(p.entryId, "placement", scoring.placePoints[p.place - 1] ?? 0);
  }
  for (const [key, t] of totals) t.wrestlers = wrestlers.get(key)?.size ?? 0;
  return [...totals.values()].sort((a, b) => b.points - a.points || a.team.localeCompare(b.team));
}
