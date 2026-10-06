import { describe, expect, it } from "vitest";
import { expectedScore, ratingBand, ratingDelta, seedRating } from "../src/index.js";

describe("ratings", () => {
  it("seeds from the coach's level", () => {
    expect(seedRating("novice")).toBe(900);
    expect(seedRating("advanced")).toBe(1300);
    expect(seedRating(null)).toBe(1000);
  });

  it("moves more for an upset than an expected win", () => {
    const upset = ratingDelta({ rating: 900, matches: 20 }, { rating: 1300, matches: 20 }, "DEC");
    const expected = ratingDelta({ rating: 1300, matches: 20 }, { rating: 900, matches: 20 }, "DEC");
    expect(upset).toBeGreaterThan(25);
    expect(expected).toBeLessThan(5);
    expect(expectedScore(1000, 1000)).toBe(0.5);
  });

  it("counts falls more, provisional wrestlers faster, and ignores forfeits", () => {
    const even = { rating: 1000, matches: 20 };
    expect(ratingDelta(even, even, "DEC")).toBe(16);
    expect(ratingDelta(even, even, "FALL")).toBe(20);
    expect(ratingDelta({ rating: 1000, matches: 2 }, even, "DEC")).toBe(24);
    expect(ratingDelta(even, even, "FOR")).toBe(0);
    expect(ratingDelta(even, even, "INJ")).toBe(0);
  });

  it("labels ratings in plain terms", () => {
    expect([ratingBand(950), ratingBand(1100), ratingBand(1250)]).toEqual(["novice", "intermediate", "advanced"]);
  });
});
