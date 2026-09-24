import { describe, expect, it } from "vitest";
import {
  BYE,
  type Bracket,
  type BracketResult,
  doubleElimination,
  drawBracket,
  feedingBouts,
  resolveBracket,
  seedLines,
  seededRandom,
  singleElimination,
} from "../src/index.js";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `w${i + 1}`);

/** Wrestle a whole bracket with random winners. */
function simulate(bracket: Bracket, draw: (string | null)[], random: () => number) {
  const results: Record<string, BracketResult> = {};
  for (;;) {
    const r = resolveBracket(bracket, draw, results);
    const ready = r.bouts.filter((b) => b.status === "ready");
    if (ready.length === 0) return { resolved: r, results };
    for (const b of ready) results[b.bout.id] = { winner: random() < 0.5 ? b.top! : b.bottom! };
  }
}

describe("seedLines", () => {
  it("spreads top seeds apart", () => {
    expect(seedLines(4)).toEqual([1, 4, 2, 3]);
    expect(seedLines(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
});

describe("bracket shapes", () => {
  it("builds the standard 16-man double elim", () => {
    const b = doubleElimination(16, { places: 6 });
    const count = (prefix: string) => b.bouts.filter((x) => x.id.startsWith(prefix)).length;
    expect(count("W")).toBe(15);
    expect(["L1-", "L2-", "L3-", "L4-"].map(count)).toEqual([4, 4, 2, 2]);
    expect(b.bouts.filter((x) => x.section === "placement").map((x) => x.id)).toEqual(["P3", "P5"]);
  });

  it("crosses quarterfinal losers over to the other half of the consolation bracket", () => {
    const b = doubleElimination(16);
    const l21 = b.bouts.find((x) => x.id === "L2-1")!;
    expect(l21.top).toEqual({ kind: "winner", bout: "L1-1" });
    expect(l21.bottom).toEqual({ kind: "loser", bout: "W2-4" });
  });

  it("puts all placement bouts in the last session and bouts after their feeders", () => {
    const b = doubleElimination(16, { places: 8 });
    const round = new Map(b.bouts.map((x) => [x.id, x.round]));
    const last = Math.max(...b.bouts.map((x) => x.round));
    for (const x of b.bouts) {
      if (x.forPlace) expect(x.round).toBe(last);
      for (const s of [x.top, x.bottom]) if (s.kind !== "seed") expect(round.get(s.bout)!).toBeLessThan(x.round);
    }
  });

  it("rejects bad sizes", () => {
    expect(() => singleElimination(6)).toThrow(/power of 2/);
    expect(() => doubleElimination(2)).toThrow(/at least 4/);
  });
});

describe("full tournaments (random results)", () => {
  for (const [size, entrants, places] of [
    [4, 3, 4],
    [4, 4, 4],
    [8, 5, 6],
    [8, 8, 8],
    [16, 11, 6],
    [16, 16, 8],
    [32, 23, 8],
  ] as const) {
    it(`${entrants} wrestlers in a ${size} double elim, placing ${places}`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const random = seededRandom(seed);
        const bracket = doubleElimination(size, { places });
        const draw = drawBracket(ids(entrants).map((id) => ({ id })), { size, random });
        const { resolved } = simulate(bracket, draw, random);

        // Every bout is settled.
        expect(resolved.bouts.filter((b) => b.status === "ready" || b.status === "waiting")).toEqual([]);
        expect(resolved.conflicts).toEqual([]);

        // Nobody wrestles themselves, and nobody keeps advancing after a second
        // loss (5th/7th place bouts are between two-loss wrestlers, by design).
        const losses = new Map<string, number>();
        for (const b of resolved.bouts.filter((x) => x.status === "done")) {
          expect(b.top).not.toBe(b.bottom);
          if (b.bout.section !== "placement") {
            for (const w of [b.top!, b.bottom!]) expect(losses.get(w) ?? 0).toBeLessThan(2);
          }
          losses.set(b.loser!, (losses.get(b.loser!) ?? 0) + 1);
        }

        // Places 1..N filled by distinct real wrestlers.
        const expectedPlaces = Math.min(places, entrants);
        const placed = [...resolved.placements.entries()].filter(([p]) => p <= expectedPlaces);
        expect(placed.map(([p]) => p).sort((a, b) => a - b)).toEqual(
          Array.from({ length: expectedPlaces }, (_, i) => i + 1),
        );
        expect(new Set(placed.map(([, w]) => w)).size).toBe(expectedPlaces);
        expect(placed.every(([, w]) => w !== BYE)).toBe(true);
      }
    });
  }

  it("single elimination with a 3rd place bout", () => {
    const random = seededRandom(7);
    const bracket = singleElimination(8, { thirdPlace: true });
    const { resolved } = simulate(bracket, drawBracket(ids(7).map((id) => ({ id })), { random }), random);
    expect([...resolved.placements.keys()].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("byes", () => {
  it("gives byes to the top seeds and skips them in the consolation bracket", () => {
    const bracket = doubleElimination(8);
    const draw = drawBracket(ids(5).map((id) => ({ id })), { seeds: ["w1", "w2", "w3"], random: seededRandom(1) });
    expect(draw.slice(5)).toEqual([null, null, null]);
    const r = resolveBracket(bracket, draw);
    const byes = r.bouts.filter((b) => b.bout.id.startsWith("W1") && b.status === "bye").map((b) => b.winner);
    expect(byes.sort()).toEqual(["w1", "w2", "w3"]);
    // Consolation round 1 has at most one real first-round loser in each bout here, so both are byes.
    expect(r.bouts.filter((b) => b.bout.id.startsWith("L1")).every((b) => b.status === "bye")).toBe(true);
  });

  it("looks through byes to find the real feeding bouts", () => {
    const bracket = doubleElimination(8);
    const draw = drawBracket(ids(5).map((id) => ({ id })), { seeds: ["w1", "w2", "w3"], random: seededRandom(1) });
    const r = resolveBracket(bracket, draw);
    // W2-1 = winner W1-1 (seed 1 bye) vs winner W1-2 (4 v 5, a real bout).
    expect(feedingBouts(r, "W2-1")).toEqual(["W1-2"]);
  });
});

describe("corrections", () => {
  it("flags later bouts wrestled by the wrong wrestler after a correction", () => {
    const bracket = singleElimination(4);
    const draw = ["a", "b", "c", "d"]; // W1-1: a v d, W1-2: b v c
    const results: Record<string, BracketResult> = { "W1-1": { winner: "a" }, "W1-2": { winner: "b" }, "W2-1": { winner: "a" } };
    expect(resolveBracket(bracket, draw, results).conflicts).toEqual([]);
    results["W1-1"] = { winner: "d" };
    const r = resolveBracket(bracket, draw, results);
    expect(r.conflicts.map((c) => c.bout.id)).toEqual(["W2-1"]);
    expect(r.placements.size).toBe(0);
  });
});

describe("true second", () => {
  const bracket = doubleElimination(4, { trueSecond: true }); // W1-1: 1v4, W1-2: 2v3, L1-1 = 3rd place
  const draw = ["a", "b", "c", "d"];

  it("is wrestled when 3rd place hasn't lost to the runner-up", () => {
    // a beats d, b beats c, a beats b in the final. d beats c for 3rd. d never met b.
    const results = { "W1-1": { winner: "a" }, "W1-2": { winner: "b" }, "W2-1": { winner: "a" }, "L1-1": { winner: "d" } };
    let r = resolveBracket(bracket, draw, results);
    expect(r.bouts.find((b) => b.bout.id === "TS")).toMatchObject({ status: "ready", top: "b", bottom: "d" });
    expect(r.placements.has(2)).toBe(false);
    r = resolveBracket(bracket, draw, { ...results, TS: { winner: "d" } });
    expect([r.placements.get(1), r.placements.get(2), r.placements.get(3), r.placements.get(4)]).toEqual(["a", "d", "b", "c"]);
  });

  it("isn't needed when they already met", () => {
    // c beats b in round 1 and a in the final? No: make the runner-up the one 3rd place lost to.
    // a beats d, c beats b, a beats c in the final, b beats d for 3rd: b and c already met.
    const results = { "W1-1": { winner: "a" }, "W1-2": { winner: "c" }, "W2-1": { winner: "a" }, "L1-1": { winner: "b" } };
    const r = resolveBracket(bracket, draw, results);
    expect(r.bouts.find((b) => b.bout.id === "TS")!.status).toBe("not-needed");
    expect([r.placements.get(2), r.placements.get(3)]).toEqual(["c", "b"]);
  });
});

describe("drawBracket", () => {
  it("keeps teammates apart in the first round when possible", () => {
    const entrants = ids(8).map((id, i) => ({ id, team: i < 4 ? "Hawks" : "Eagles" }));
    for (let seed = 1; seed <= 10; seed++) {
      const draw = drawBracket(entrants, { random: seededRandom(seed) });
      const team = new Map(entrants.map((e) => [e.id, e.team]));
      const bracket = singleElimination(8);
      const firstRound = resolveBracket(bracket, draw).bouts.filter((b) => b.bout.round === 1);
      for (const b of firstRound) expect(team.get(b.top!)).not.toBe(team.get(b.bottom!));
    }
  });

  it("puts seeds on their seed numbers", () => {
    const draw = drawBracket(ids(6).map((id) => ({ id })), { seeds: ["w4", "w2"], random: seededRandom(3) });
    expect(draw.slice(0, 2)).toEqual(["w4", "w2"]);
    expect(draw).toHaveLength(8);
  });
});
