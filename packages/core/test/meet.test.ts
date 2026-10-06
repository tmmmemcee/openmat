import { describe, expect, it } from "vitest";
import { DEFAULT_MEET_OPTIONS, type MeetWrestler, checkPair, meetScores, pairMeet } from "../src/meet.js";

const kid = (id: string, team: string, weight: number, age = 9, extra: Partial<MeetWrestler> = {}): MeetWrestler => ({ id, team, weight, age, gender: "boys", ...extra });

const defaultsWith = (o: object) => ({ ...DEFAULT_MEET_OPTIONS, ...o });
const matchesOf = (pairings: { a: string; b: string }[], id: string) => pairings.filter((p) => p.a === id || p.b === id).length;

describe("checkPair", () => {
  it("allows a bit more weight and age when experience matches", () => {
    const a = kid("a", "X", 60, 9), b = kid("b", "Y", 67.8, 9); // 13% heavier
    expect(checkPair(a, b).ok).toBe(false);
    expect(checkPair({ ...a, skill: 1100 }, { ...b, skill: 1150 }).ok).toBe(true);
    expect(checkPair({ ...a, skill: 1100 }, { ...b, skill: 1150 }).flags).toContain("13% weight gap (evenly matched)");
    expect(checkPair({ ...a, skill: 900 }, { ...b, skill: 1300 }).ok).toBe(false);

    const old = kid("c", "Y", 61, 12);
    expect(checkPair(a, old).reason).toBe("3 years apart (limit 2)");
    expect(checkPair({ ...a, skill: 1000 }, { ...old, skill: 1000 }).ok).toBe(true);
  });

  it("never pairs teammates, or boys with girls unless allowed", () => {
    expect(checkPair(kid("a", "X", 60), kid("b", "X", 60)).reason).toBe("Same team");
    const girl = kid("g", "Y", 60, 9, { gender: "girls" });
    expect(checkPair(kid("a", "X", 60), girl).ok).toBe(false);
    expect(checkPair(kid("a", "X", 60), girl, defaultsWith({ mixGenders: true })).ok).toBe(true);
  });
});


describe("pairMeet", () => {
  it("gives everyone the requested number of matches across teams in a dual", () => {
    const kids = [
      ...[50, 52, 54, 56, 58, 60].map((w, i) => kid(`x${i}`, "X", w)),
      ...[51, 53, 55, 57, 59, 61].map((w, i) => kid(`y${i}`, "Y", w)),
    ];
    const { pairings, short } = pairMeet(kids, { matchesPerKid: 2 });
    for (const k of kids) expect(matchesOf(pairings, k.id), k.id).toBeLessThanOrEqual(2);
    for (const p of pairings) expect(p.a[0]).not.toBe(p.b[0]);
    // No pair twice.
    expect(new Set(pairings.map((p) => [p.a, p.b].sort().join())).size).toBe(pairings.length);
    expect(short.map((s) => s.id).sort()).toEqual(kids.filter((k) => matchesOf(pairings, k.id) < 2).map((k) => k.id).sort());
    // Everyone has at least two kids close enough, so everyone gets both.
    expect(short).toEqual([]);
    expect(pairings).toHaveLength(12);
    // First-round matches are the close ones.
    expect(pairings.slice(0, 6).every((p) => p.weightPct <= 4)).toBe(true);
  });

  it("lets the kid with the fewest options choose first", () => {
    // h can only wrestle m (heavy); m's closest is l. Greedy-by-closeness would strand h.
    const kids = [kid("l", "X", 70), kid("m", "Y", 72), kid("h", "X", 78)];
    const { pairings, short } = pairMeet(kids, { matchesPerKid: 1 });
    expect(pairings.map((p) => [p.a, p.b].sort().join())).toEqual(["h,m"]);
    expect(short).toEqual([{ id: "l", matches: 0, reason: "Everyone close enough already has their matches" }]);
  });

  it("uses all three teams in a tri-meet and explains who is short", () => {
    const kids = [kid("a", "X", 60), kid("b", "Y", 61), kid("c", "Z", 62), kid("big", "X", 120)];
    const { pairings, short } = pairMeet(kids, { matchesPerKid: 2 });
    expect(pairings.map((p) => [p.a, p.b].sort().join()).sort()).toEqual(["a,b", "a,c", "b,c"]);
    expect(short).toEqual([{ id: "big", matches: 0, reason: "No one on another team within 10% and 2 years" }]);
  });

  it("keeps existing pairs and counts them", () => {
    const kids = [kid("a", "X", 60), kid("b", "Y", 61), kid("c", "Y", 62)];
    const { pairings } = pairMeet(kids, { matchesPerKid: 1 }, [["a", "c"]]);
    expect(pairings).toEqual([]);
    const two = pairMeet(kids, { matchesPerKid: 2 }, [["a", "c"]]);
    expect(two.pairings.map((p) => [p.a, p.b].sort().join())).toEqual(["a,b"]);
  });
});

describe("meetScores", () => {
  it("adds team points per win, overall and per pair of teams", () => {
    const s = meetScores([
      { teamA: "X", teamB: "Y", winnerTeam: "X", teamPoints: 6 },
      { teamA: "Y", teamB: "X", winnerTeam: "Y", teamPoints: 3 },
      { teamA: "X", teamB: "Z", winnerTeam: "Z", teamPoints: 4 },
    ]);
    expect(s.teams).toEqual([
      { team: "X", points: 6, wins: 1, losses: 2 },
      { team: "Z", points: 4, wins: 1, losses: 0 },
      { team: "Y", points: 3, wins: 1, losses: 1 },
    ]);
    expect(s.duals).toEqual([
      { teams: ["X", "Y"], points: [6, 3], bouts: 2 },
      { teams: ["X", "Z"], points: [0, 4], bouts: 1 },
    ]);
  });
});
