/**
 * Rulesets: point values, penalties, match format and result types for each
 * style, as data. Rules change most seasons, so each ruleset is labeled with
 * its season and pinned per event (a mid-season update never rewrites old
 * results). Values here were checked against the linked rule books; anything
 * not yet confirmed is listed in `toVerify`.
 */

export type Corner = "A" | "B";

export interface ScoringAction {
  /** Short code shown on the score sheet, e.g. "T3", "E1", "N2". */
  code: string;
  label: string;
  points: number;
  /**
   * False for points that aren't from wrestling action (UWW: passivity,
   * lost challenge). Matters for UWW tie criteria.
   */
  technical: boolean;
}

export interface PenaltyProgression {
  kind: string;
  label: string;
  /**
   * Points to the opponent for the 1st, 2nd, 3rd... offence. 0 = warning,
   * "DQ" = disqualification. Offences past the end of the list repeat the
   * last entry.
   */
  steps: (number | "DQ")[];
  /** Kinds that share one running count (NFHS: technical violations, illegal holds and roughness). */
  sharedWith?: string[];
}

export type WinType =
  // Folkstyle
  | "FALL"
  | "TF" // technical fall
  | "MD" // major decision
  | "DEC" // decision
  | "FOR" // forfeit
  | "INJ" // injury default
  | "DQ" // disqualification
  | "MFF" // medical forfeit
  // UWW (with classification points in the name's definition)
  | "VFA" // fall 5:0
  | "VSU" // technical superiority, loser scoreless 4:0
  | "VSU1" // technical superiority, loser scored 4:1
  | "VPO" // points, loser scoreless 3:0
  | "VPO1" // points, loser scored 3:1
  | "VCA" // 3 cautions 5:0
  | "VIN" // injury 5:0
  | "VFO" // forfeit 5:0
  | "DSQ"; // disqualification 5:0

export interface Ruleset {
  id: string;
  name: string;
  style: "folkstyle" | "freestyle" | "greco-roman";
  season: string;
  cornerColors: Record<Corner, string>;
  /** Default regulation periods in seconds. Divisions can override (youth: 1-1-1). */
  periodsSec: number[];
  breakSec: number;
  actions: ScoringAction[];
  penalties: PenaltyProgression[];
  /** Match ends when the lead reaches this. */
  techFallMargin: number;
  /** Folkstyle: winning margin that makes a major decision (up to techFallMargin - 1). */
  majorDecisionMargin?: number;
  /** NCAA: net riding time advantage (seconds) worth one point at the end of the match. */
  ridingTimePointSec?: number;
  /** UWW: this many cautions loses the bout. */
  cautionsToLose?: number;
  /** Ties at the end of regulation go to overtime (folkstyle) or tie criteria (UWW). */
  tieBreak: "overtime" | "uww-criteria";
  overtime?: string;
  /** Team points for the winner, by win type. */
  teamPoints: Partial<Record<WinType, number>>;
  /** UWW classification points [winner, loser]. */
  classificationPoints?: Partial<Record<WinType, [number, number]>>;
  /** Default minimum rest between a wrestler's bouts, in minutes. */
  minRestMin?: number;
  /** Most bouts a wrestler may have in one day. */
  maxBoutsPerDay?: number;
  links: { label: string; url: string }[];
  /** Plain-English explanation for fans and new parents. */
  summary: string;
  toVerify?: string[];
}

const folkstyleActions: ScoringAction[] = [
  { code: "T3", label: "Takedown", points: 3, technical: true },
  { code: "E1", label: "Escape", points: 1, technical: true },
  { code: "R2", label: "Reversal", points: 2, technical: true },
  { code: "N2", label: "Near fall (2 sec)", points: 2, technical: true },
  { code: "N3", label: "Near fall (3 sec)", points: 3, technical: true },
  { code: "N4", label: "Near fall (4 sec)", points: 4, technical: true },
  { code: "N5", label: "Near fall + injury/blood", points: 5, technical: true },
];

const folkstyleTeamPoints: Ruleset["teamPoints"] = {
  FALL: 6,
  FOR: 6,
  INJ: 6,
  DQ: 6,
  MFF: 6,
  TF: 5,
  MD: 4,
  DEC: 3,
};

const stalling: PenaltyProgression = {
  kind: "stalling",
  label: "Stalling",
  steps: [0, 1, 1, 2, "DQ"],
};

const NFHS_LINKS = [
  { label: "NFHS wrestling rules (rule book sold by NFHS)", url: "https://nfhs.org/sports/wrestling/rules" },
  { label: "NFHS 2025-26 rule changes", url: "https://nfhs.org/resources/sports/wrestling-rules-changes-2025-26" },
  { label: "NFHS 2024-25 rule changes", url: "https://nfhs.org/resources/sports/wrestling-rules-changes-2024-25" },
];

const FOLKSTYLE_SUMMARY =
  "Folkstyle (high school and college style). Takedown 3, escape 1, reversal 2, near fall 2-4 points " +
  "depending on how long the opponent's back is held near the mat. Pin both shoulders to win immediately (a fall). " +
  "A 15-point lead ends the match (technical fall). Winning by 8-14 is a major decision.";

export const NFHS_2025_26: Ruleset = {
  id: "nfhs-2025-26",
  name: "High School (NFHS) Folkstyle",
  style: "folkstyle",
  season: "2025-26",
  cornerColors: { A: "red", B: "green" },
  periodsSec: [120, 120, 120],
  breakSec: 0,
  actions: folkstyleActions,
  penalties: [
    stalling,
    {
      kind: "technical",
      label: "Technical violation / illegal hold / unnecessary roughness",
      steps: [1, 1, 2, "DQ"],
      sharedWith: ["illegal-hold", "roughness"],
    },
    { kind: "illegal-hold", label: "Illegal hold", steps: [1, 1, 2, "DQ"], sharedWith: ["technical", "roughness"] },
    { kind: "roughness", label: "Unnecessary roughness", steps: [1, 1, 2, "DQ"], sharedWith: ["technical", "illegal-hold"] },
    { kind: "unsportsmanlike", label: "Unsportsmanlike conduct", steps: [1, 1, 2, "DQ"] },
    { kind: "flagrant", label: "Flagrant misconduct", steps: ["DQ"] },
  ],
  techFallMargin: 15,
  majorDecisionMargin: 8,
  tieBreak: "overtime",
  overtime:
    "1-minute sudden victory from neutral; if still tied, two 30-second tiebreakers (each wrestler chooses once); then a 30-second ultimate tiebreaker.",
  teamPoints: folkstyleTeamPoints,
  minRestMin: 30,
  maxBoutsPerDay: 6,
  links: NFHS_LINKS,
  summary: FOLKSTYLE_SUMMARY,
  toVerify: [
    "Unsportsmanlike conduct progression and whether it shares a count with other penalties",
    "Overtime format details for 2025-26",
  ],
};

export const USAW_KIDS_FOLKSTYLE_2025_26: Ruleset = {
  ...NFHS_2025_26,
  id: "usaw-kids-folkstyle-2025-26",
  name: "USA Wrestling Kids Folkstyle",
  periodsSec: [60, 60, 60],
  breakSec: 30,
  minRestMin: 15,
  maxBoutsPerDay: undefined,
  links: [
    { label: "USA Wrestling folkstyle (NFHS scoring with USAW modifications)", url: "https://usawrestlingevents.com/event/2600004102/rules" },
    ...NFHS_LINKS,
  ],
  toVerify: [...(NFHS_2025_26.toVerify ?? []), "Event-specific USAW modifications (e.g. neutral starts in girls divisions)"],
};

export const NCAA_2025_27: Ruleset = {
  id: "ncaa-2025-27",
  name: "College (NCAA) Folkstyle",
  style: "folkstyle",
  season: "2025-27",
  cornerColors: { A: "red", B: "green" },
  periodsSec: [180, 120, 120],
  breakSec: 0,
  actions: folkstyleActions,
  penalties: [
    stalling,
    { kind: "technical", label: "Technical violation / illegal hold / unnecessary roughness", steps: [1, 1, 2, "DQ"] },
    { kind: "unsportsmanlike", label: "Unsportsmanlike conduct", steps: [1, 1, 2, "DQ"] },
    { kind: "flagrant", label: "Flagrant misconduct", steps: ["DQ"] },
  ],
  techFallMargin: 15,
  majorDecisionMargin: 8,
  ridingTimePointSec: 60,
  tieBreak: "overtime",
  overtime:
    "2-minute sudden victory from neutral; then two 30-second tiebreakers (riding time kept). Further rounds: 1-minute sudden victory and two 30-second tiebreakers.",
  teamPoints: folkstyleTeamPoints,
  links: [
    { label: "NCAA men's rules book 2025-27", url: "https://ncaaorg.s3.amazonaws.com/championships/sports/wrestling/rules/PRMWR_RulesBook.pdf" },
    { label: "NCAA 2025-27 rule changes", url: "https://ncaaorg.s3.amazonaws.com/championships/sports/wrestling/rules/mens/2025-27PRMWR_MajorRulesChanges.pdf" },
    { label: "NCAA women's rules", url: "https://ncaaorg.s3.amazonaws.com/championships/sports/wrestling/rules/womens/2025PRWWR_NCWWCRulebook.pdf" },
  ],
  summary: `${FOLKSTYLE_SUMMARY} College also scores riding time: 1 point for a net minute or more controlling the opponent on top.`,
  toVerify: ["Technical/unsportsmanlike penalty progressions (stalling verified)", "Minimum rest between bouts"],
};

const uwwLinks = [
  { label: "UWW International Wrestling Rules", url: "https://cdn.uww.org/2025-12/wrestling_rules_1.pdf" },
  { label: "USA Wrestling rule book", url: "https://www.usawmembership.com/usa_wrestling_rule_book.pdf" },
];

const uwwClassification: Ruleset["classificationPoints"] = {
  VFA: [5, 0],
  VCA: [5, 0],
  VIN: [5, 0],
  VFO: [5, 0],
  DSQ: [5, 0],
  VSU: [4, 0],
  VSU1: [4, 1],
  VPO: [3, 0],
  VPO1: [3, 1],
};

const uwwTeamPoints: Ruleset["teamPoints"] = {
  VFA: 5,
  VCA: 5,
  VIN: 5,
  VFO: 5,
  DSQ: 5,
  VSU: 4,
  VSU1: 4,
  VPO: 3,
  VPO1: 3,
};

export const UWW_FREESTYLE_2025: Ruleset = {
  id: "uww-freestyle-2025",
  name: "Freestyle (UWW)",
  style: "freestyle",
  season: "2025",
  cornerColors: { A: "red", B: "blue" },
  periodsSec: [180, 180],
  breakSec: 30,
  actions: [
    { code: "1", label: "Step out / other (1)", points: 1, technical: true },
    { code: "R1", label: "Reversal", points: 1, technical: true },
    { code: "T2", label: "Takedown", points: 2, technical: true },
    { code: "2", label: "Exposure / other (2)", points: 2, technical: true },
    { code: "4", label: "Throw (4)", points: 4, technical: true },
    { code: "5", label: "Grand amplitude to danger (5)", points: 5, technical: true },
    { code: "P1", label: "Passivity point (activity period)", points: 1, technical: false },
    { code: "CH1", label: "Challenge lost by opponent", points: 1, technical: false },
  ],
  // A caution (0) gives the opponent 1 point, or 2 in some situations (the
  // table picks); 3 cautions lose the bout.
  penalties: [{ kind: "caution", label: "Caution (0)", steps: [1] }],
  techFallMargin: 10,
  cautionsToLose: 3,
  tieBreak: "uww-criteria",
  teamPoints: uwwTeamPoints,
  classificationPoints: uwwClassification,
  minRestMin: 15,
  links: uwwLinks,
  summary:
    "Freestyle (Olympic style). Two 3-minute periods (2 minutes for U15/U17). Takedown 2, step out 1, exposing the back 2, " +
    "big throws 4 or 5. A 10-point lead ends the bout. Ties go to the wrestler with the biggest move, then fewest cautions, then the last point scored.",
  toVerify: ["Tie criterion 4.1 (1-1 passivity-only scores) is not modeled; the director resolves it"],
};

export const UWW_GRECO_2025: Ruleset = {
  ...UWW_FREESTYLE_2025,
  id: "uww-greco-2025",
  name: "Greco-Roman (UWW)",
  style: "greco-roman",
  actions: UWW_FREESTYLE_2025.actions.map((a) =>
    a.code === "P1" ? { ...a, label: "Passivity point (1st/2nd passivity)" } : a,
  ),
  techFallMargin: 8,
  summary:
    "Greco-Roman (Olympic style, no holds below the waist). Two 3-minute periods. Takedown 2, step out 1, exposure 2, " +
    "big throws 4 or 5. An 8-point lead ends the bout. Ties go to the wrestler with the biggest move, then fewest cautions, then the last point scored.",
  toVerify: [],
};

export const RULESETS: Ruleset[] = [NFHS_2025_26, USAW_KIDS_FOLKSTYLE_2025_26, NCAA_2025_27, UWW_FREESTYLE_2025, UWW_GRECO_2025];
