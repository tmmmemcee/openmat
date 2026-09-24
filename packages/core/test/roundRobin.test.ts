import { describe, expect, it } from "vitest";
import { poolStandings, roundRobin, type BoutResult } from "../src/index.js";

const pairKey = (a: string, b: string) => [a, b].sort().join("-");

describe("roundRobin", () => {
  for (const n of [2, 3, 4, 5, 6]) {
    it(`pairs everyone exactly once for ${n} wrestlers`, () => {
      const ids = Array.from({ length: n }, (_, i) => `w${i + 1}`);
      const bouts = roundRobin(ids);
      expect(bouts).toHaveLength((n * (n - 1)) / 2);
      expect(new Set(bouts.map((b) => pairKey(b.wrestler1, b.wrestler2))).size).toBe(bouts.length);
      for (const round of new Set(bouts.map((b) => b.round))) {
        const inRound = bouts.filter((b) => b.round === round).flatMap((b) => [b.wrestler1, b.wrestler2]);
        expect(new Set(inRound).size).toBe(inRound.length);
      }
    });
  }

  it("avoids back-to-back bouts in a pool of 6", () => {
    const bouts = roundRobin(["a", "b", "c", "d", "e", "f"]);
    for (let i = 1; i < bouts.length; i++) {
      const prev = [bouts[i - 1]!.wrestler1, bouts[i - 1]!.wrestler2];
      expect(prev).not.toContain(bouts[i]!.wrestler1);
      expect(prev).not.toContain(bouts[i]!.wrestler2);
    }
  });
});

describe("poolStandings", () => {
  const r = (w1: string, w2: string, winner: string, extra: Partial<BoutResult> = {}): BoutResult => ({
    wrestler1: w1,
    wrestler2: w2,
    winner,
    winType: "DEC",
    ...extra,
  });

  it("orders by wins", () => {
    const s = poolStandings(["a", "b", "c"], [r("a", "b", "a"), r("a", "c", "a"), r("b", "c", "b")]);
    expect(s.map((x) => [x.wrestlerId, x.place])).toEqual([["a", 1], ["b", 2], ["c", 3]]);
  });

  it("breaks a two-way tie by head-to-head", () => {
    // a and b both 2-1; b beat a.
    const s = poolStandings(
      ["a", "b", "c", "d"],
      [r("a", "b", "b"), r("a", "c", "a"), r("a", "d", "a"), r("b", "c", "c"), r("b", "d", "b"), r("c", "d", "d")],
    );
    const b = s.find((x) => x.wrestlerId === "b")!;
    const a = s.find((x) => x.wrestlerId === "a")!;
    expect(b.place).toBeLessThan(a.place);
    expect(b.tiebreak).toBe("head-to-head");
  });

  it("breaks a three-way circle by falls, then head-to-head between the last two", () => {
    // a>b, b>c, c>a: head-to-head can't separate. a has 1 fall, b and c none; then b beat c.
    const s = poolStandings(["a", "b", "c"], [r("a", "b", "a", { winType: "FALL", fallTimeSec: 70 }), r("b", "c", "b"), r("c", "a", "c")]);
    expect(s.map((x) => [x.wrestlerId, x.place, x.tiebreak])).toEqual([
      ["a", 1, "falls"],
      ["b", 2, "head-to-head"],
      ["c", 3, "head-to-head"],
    ]);
  });

  it("flags a tie nothing can break", () => {
    const s = poolStandings(["a", "b", "c"], [r("a", "b", "a"), r("b", "c", "b"), r("c", "a", "c")]);
    expect(s.every((x) => x.place === 1 && x.unresolvedTie)).toBe(true);
  });

  it("uses fastest total fall time when falls are equal", () => {
    const s = poolStandings(
      ["a", "b", "c"],
      [
        r("a", "b", "a", { winType: "FALL", fallTimeSec: 30 }),
        r("b", "c", "b", { winType: "FALL", fallTimeSec: 90 }),
        r("c", "a", "c", { winType: "FALL", fallTimeSec: 60 }),
      ],
    );
    expect(s.map((x) => x.wrestlerId)).toEqual(["a", "c", "b"]);
    expect(s.every((x) => x.tiebreak === "fastest-falls")).toBe(true);
  });
});
