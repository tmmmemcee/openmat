/**
 * Private wrestler ratings for fair youth pairings and groupings. Never shown
 * publicly.
 *
 * A coach-set experience level seeds the rating; every real match (not a
 * forfeit, injury default or DQ) moves it Elo-style. New wrestlers move
 * faster, and dominant wins (fall, tech fall, major) count a bit more.
 */
import type { WinType } from "./rulesets.js";

export type ExperienceLevel = "novice" | "intermediate" | "advanced";

export const LEVEL_SEED: Record<ExperienceLevel, number> = { novice: 900, intermediate: 1100, advanced: 1300 };
export const DEFAULT_RATING = 1000;

/** Starting rating for a wrestler with no rated matches. */
export function seedRating(level: ExperienceLevel | null | undefined): number {
  return level ? LEVEL_SEED[level] : DEFAULT_RATING;
}

/** Results that say nothing about wrestling ability. */
const NOT_RATED = new Set<WinType>(["FOR", "INJ", "DQ", "MFF", "VFO", "VIN", "DSQ", "VCA"]);
const DOMINANCE: Partial<Record<WinType, number>> = { FALL: 1.25, TF: 1.25, MD: 1.1, VFA: 1.25, VSU: 1.25, VSU1: 1.2 };

export function isRated(winType: WinType): boolean {
  return !NOT_RATED.has(winType);
}

/** Chance that a wrestler rated `a` beats one rated `b`. */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/**
 * Rating change for the winner (the loser gets the negative), given both
 * ratings before the match and how many rated matches each has had.
 */
export function ratingDelta(winner: { rating: number; matches: number }, loser: { rating: number; matches: number }, winType: WinType): number {
  if (!isRated(winType)) return 0;
  // Provisional (fewer than 10 matches): ratings settle faster.
  const k = Math.min(winner.matches, loser.matches) < 10 ? 48 : 32;
  const change = k * (DOMINANCE[winType] ?? 1) * (1 - expectedScore(winner.rating, loser.rating));
  return Math.round(change * 10) / 10;
}

/** A rough label for a rating, for coaches. */
export function ratingBand(rating: number): ExperienceLevel {
  return rating < 1000 ? "novice" : rating < 1200 ? "intermediate" : "advanced";
}
