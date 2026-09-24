import type { Ruleset } from "@openmat/core";

export const WIN_TYPE_LABELS: Record<string, string> = {
  DEC: "Decision",
  MD: "Major decision",
  TF: "Tech fall",
  FALL: "Fall (pin)",
  FOR: "Forfeit",
  INJ: "Injury default",
  DQ: "Disqualification",
  MFF: "Medical forfeit",
  VPO1: "Points",
  VPO: "Points (loser scoreless)",
  VSU1: "Technical superiority",
  VSU: "Tech superiority (loser scoreless)",
  VFA: "Fall",
  VCA: "3 cautions",
  VIN: "Injury",
  VFO: "Forfeit",
  DSQ: "Disqualification",
};

export const NEEDS_SCORE = new Set(["DEC", "MD", "TF", "VPO", "VPO1", "VSU", "VSU1"]);
export const NEEDS_TIME = new Set(["FALL", "INJ", "TF"]);

/** Penalty buttons for the scoring screen (shared-count kinds shown once). */
export function penaltyButtons(ruleset: Ruleset): { kind: string; label: string; points?: number }[] {
  const shown = new Set<string>();
  const out: { kind: string; label: string; points?: number }[] = [];
  for (const p of ruleset.penalties) {
    if (shown.has(p.kind)) continue;
    for (const k of [p.kind, ...(p.sharedWith ?? [])]) shown.add(k);
    if (p.kind === "caution") {
      out.push({ kind: "caution", label: "Caution +1" }, { kind: "caution", label: "Caution +2", points: 2 });
    } else {
      const short: Record<string, string> = { stalling: "Stalling", technical: "Tech violation", unsportsmanlike: "Unsportsmanlike", flagrant: "Flagrant" };
      out.push({ kind: p.kind, label: short[p.kind] ?? p.label });
    }
  }
  return out;
}
