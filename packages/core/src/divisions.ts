/**
 * Age divisions ("8U", "10U", ...), USA Wrestling style: a wrestler's age is
 * the age they turn during the season year (seasonYear - birthYear), and they
 * belong to the youngest division whose max age is >= that age.
 *
 * Example, season 2026: 8U = born 2018-2019, 10U = born 2016-2017.
 */

export interface AgeDivision {
  /** Display name, e.g. "10U". */
  name: string;
  /** Oldest age (as of the season year) allowed in this division. */
  maxAge: number;
}

/** Common youth divisions. Directors can define their own list. */
export const USAW_KIDS_DIVISIONS: AgeDivision[] = [
  { name: "6U", maxAge: 6 },
  { name: "8U", maxAge: 8 },
  { name: "10U", maxAge: 10 },
  { name: "12U", maxAge: 12 },
  { name: "14U", maxAge: 14 },
];

/** Divisions sorted youngest to oldest. */
export function sortDivisions(divisions: AgeDivision[]): AgeDivision[] {
  return [...divisions].sort((a, b) => a.maxAge - b.maxAge);
}

export function seasonAge(birthYear: number, seasonYear: number): number {
  return seasonYear - birthYear;
}

/**
 * The division a wrestler naturally belongs to, or undefined if they are too
 * old for every division on the list.
 */
export function nativeDivision(
  birthYear: number,
  seasonYear: number,
  divisions: AgeDivision[],
): AgeDivision | undefined {
  const age = seasonAge(birthYear, seasonYear);
  return sortDivisions(divisions).find((d) => age <= d.maxAge);
}

/**
 * The division a wrestler competes in after bumping up `bumpAge` divisions.
 * Wrestlers may only move up (older), never down.
 */
export function effectiveDivision(
  native: string,
  bumpAge: number,
  divisions: AgeDivision[],
): AgeDivision | undefined {
  if (!Number.isInteger(bumpAge) || bumpAge < 0) {
    throw new RangeError(`bumpAge must be a whole number >= 0 (wrestlers can only move up), got ${bumpAge}`);
  }
  const sorted = sortDivisions(divisions);
  const i = sorted.findIndex((d) => d.name === native);
  if (i === -1) throw new Error(`Unknown division "${native}"`);
  return sorted[i + bumpAge];
}
