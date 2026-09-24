/**
 * Live view of an event's brackets: who is in each bout (worked out from the
 * draw and results, so corrections flow through), bout status, round robin
 * standings and elimination placements.
 */
import {
  BYE,
  type Bracket as CoreBracket,
  type BracketBout,
  doubleElimination,
  poolStandings,
  resolveBracket,
  singleElimination,
} from "@openmat/core";
import type { BoutEvent, WinType } from "@openmat/core";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { boutEvents, bouts, brackets, entries } from "../db/schema.js";

type BracketRow = typeof brackets.$inferSelect;
type BoutRow = typeof bouts.$inferSelect;

export type BoutStatus = "waiting" | "ready" | "wrestling" | "done" | "bye" | "not-needed";

export interface BoutView {
  id: string;
  bracketId: string;
  key: string;
  round: number;
  label: string;
  section: "championship" | "consolation" | "placement" | "pool";
  forPlace?: number;
  /** Entry ids; "BYE" for a bye; null when not known yet. */
  a: string | null;
  b: string | null;
  /** Where an unknown wrestler will come from, e.g. "Winner of 104". */
  aFrom?: string;
  bFrom?: string;
  status: BoutStatus;
  mat: number | null;
  matOrder: number | null;
  boutNumber: string | null;
  plannedStartMin: number | null;
  durationMin: number;
  after: { boutId: string; restMin: number }[];
  startedAt: Date | null;
  endedAt: Date | null;
  clock: BoutRow["clock"];
  winnerEntryId: string | null;
  result: BoutRow["result"];
  conflict?: string;
}

export interface BracketView {
  id: string;
  divisionId: string;
  groupId: string | null;
  weightClass: string | null;
  name: string;
  format: BracketRow["format"];
  options: BracketRow["options"];
  size: number | null;
  draw: (string | null)[];
  bouts: BoutView[];
  /** Round robin standings or elimination placements: place -> entry ids. */
  places: { place: number; entryId: string; unresolvedTie?: boolean }[];
}

export function coreBracket(b: Pick<BracketRow, "format" | "size" | "options">): CoreBracket | null {
  if (b.format === "double-elim") return doubleElimination(b.size!, { places: b.options.places ?? 6, trueSecond: b.options.trueSecond ?? false });
  if (b.format === "single-elim") return singleElimination(b.size!, { thirdPlace: b.options.thirdPlace ?? true });
  return null;
}

function statusOf(row: BoutRow, base: BoutStatus): BoutStatus {
  if (base === "bye" || base === "not-needed") return base;
  if (row.winnerEntryId) return "done";
  if (row.startedAt && !row.endedAt) return "wrestling";
  return base;
}

/**
 * Describe where a slot's wrestler comes from, using bout numbers once
 * scheduled. Byes have no bout number, so look through them to the real source.
 */
function sourceText(
  source: BracketBout["top"],
  byKey: Map<string, BoutRow>,
  resolved: Map<string, { bout: BracketBout; top: string | null; bottom: string | null; status: string }>,
): string | undefined {
  if (source.kind === "seed") return undefined;
  const feeder = resolved.get(source.bout);
  if (feeder?.status === "bye" && source.kind === "winner") {
    const real = feeder.top === BYE ? feeder.bout.bottom : feeder.bout.top;
    return sourceText(real, byKey, resolved);
  }
  const row = byKey.get(source.bout);
  const name = row?.boutNumber ? `bout ${row.boutNumber}` : source.bout;
  return `${source.kind === "winner" ? "Winner" : "Loser"} of ${name}`;
}

export function viewBracket(bracket: BracketRow, rows: BoutRow[]): BracketView {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const base = {
    id: bracket.id,
    divisionId: bracket.divisionId,
    groupId: bracket.groupId,
    weightClass: bracket.weightClass,
    name: bracket.name,
    format: bracket.format,
    options: bracket.options,
    size: bracket.size,
    draw: bracket.draw,
  };
  const common = (r: BoutRow) => ({
    id: r.id,
    bracketId: r.bracketId,
    key: r.key,
    round: r.round,
    mat: r.mat,
    matOrder: r.matOrder,
    boutNumber: r.boutNumber,
    plannedStartMin: r.plannedStartMin,
    durationMin: r.durationMin,
    after: r.after,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    clock: r.clock,
    winnerEntryId: r.winnerEntryId,
    result: r.result,
  });

  const core = coreBracket(bracket);
  if (!core) {
    // Round robin.
    const ordered = [...rows].sort((x, y) => Number(x.key) - Number(y.key));
    const pool = bracket.draw.filter((x): x is string => !!x);
    const results = ordered
      .filter((r) => r.winnerEntryId && r.entryA && r.entryB)
      .map((r) => ({
        wrestler1: r.entryA!,
        wrestler2: r.entryB!,
        winner: r.winnerEntryId!,
        winType: (r.result?.winType ?? "DEC") as WinType,
        fallTimeSec: r.result?.winType === "FALL" ? fallSeconds(r.result.summary) : undefined,
      }));
    const everyoneDone = ordered.length > 0 && ordered.every((r) => r.winnerEntryId);
    return {
      ...base,
      bouts: ordered.map((r) => ({
        ...common(r),
        label: `Round ${r.round}`,
        section: "pool" as const,
        a: r.entryA,
        b: r.entryB,
        status: statusOf(r, "ready"),
      })),
      places: everyoneDone
        ? poolStandings(pool, results).map((s) => ({ place: s.place, entryId: s.wrestlerId, ...(s.unresolvedTie ? { unresolvedTie: true } : {}) }))
        : [],
    };
  }

  const results: Record<string, { winner: string }> = {};
  for (const r of rows) if (r.winnerEntryId) results[r.key] = { winner: r.winnerEntryId };
  const resolved = resolveBracket(core, bracket.draw, results);
  const byCoreId = new Map(resolved.bouts.map((rb) => [rb.bout.id, rb]));
  const views: BoutView[] = [];
  for (const bout of core.bouts) {
    const row = byKey.get(bout.id);
    if (!row) continue;
    const rb = byCoreId.get(bout.id)!;
    views.push({
      ...common(row),
      label: bout.label,
      section: bout.section,
      ...(bout.forPlace ? { forPlace: bout.forPlace } : {}),
      a: rb.top,
      b: rb.bottom,
      ...(rb.top === null ? { aFrom: sourceText(bout.top, byKey, byCoreId) } : {}),
      ...(rb.bottom === null ? { bFrom: sourceText(bout.bottom, byKey, byCoreId) } : {}),
      status: statusOf(row, rb.status === "done" ? "ready" : rb.status),
      ...(rb.conflict ? { conflict: rb.conflict } : {}),
    });
  }
  return {
    ...base,
    bouts: views,
    places: [...resolved.placements.entries()].sort((x, y) => x[0] - y[0]).map(([place, entryId]) => ({ place, entryId })),
  };
}

/** "F 1:36" -> 96. */
function fallSeconds(summary: string): number | undefined {
  const m = summary.match(/(\d+):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

export async function loadBracketViews(db: Db, eventId: string): Promise<BracketView[]> {
  const bs = await db.select().from(brackets).where(eq(brackets.eventId, eventId)).orderBy(asc(brackets.sortOrder));
  const rows = await db.select().from(bouts).where(eq(bouts.eventId, eventId));
  const byBracket = Map.groupBy(rows, (r) => r.bracketId);
  return bs.map((b) => viewBracket(b, byBracket.get(b.id) ?? []));
}

/** Public details of every wrestler that appears in the brackets. */
export async function loadWrestlers(db: Db, eventId: string) {
  return db
    .select({ id: entries.id, firstName: entries.firstName, lastName: entries.lastName, team: entries.team, divisionId: entries.divisionId })
    .from(entries)
    .where(eq(entries.eventId, eventId));
}

export async function loadBoutEvents(db: Db, boutId: string) {
  return db.select().from(boutEvents).where(eq(boutEvents.boutId, boutId)).orderBy(asc(boutEvents.seq));
}

/** Saved log rows back into scoring-engine events. */
export function toEngineEvents(log: { id: string; data: Record<string, unknown> }[]): BoutEvent[] {
  return log.map((e) => ({ ...(e.data as unknown as BoutEvent), id: e.id }));
}

export { BYE };
