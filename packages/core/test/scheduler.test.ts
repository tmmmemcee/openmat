import { describe, expect, it } from "vitest";
import {
  type SchedulableBout,
  type ScheduledBout,
  assignGroupsToMats,
  bracketScheduleBouts,
  buildSchedule,
  doubleElimination,
  drawBracket,
  estimateBoutMinutes,
  estimateMatTimes,
  poolScheduleBouts,
  resolveBracket,
  roundRobin,
  rollingAverage,
  seededRandom,
} from "../src/index.js";

/** Check the hard rules on any schedule. */
function assertValid(bouts: SchedulableBout[], schedule: ScheduledBout[]) {
  const at = new Map(schedule.map((s) => [s.boutId, s]));
  expect(schedule).toHaveLength(bouts.length);
  for (const b of bouts) {
    const s = at.get(b.id)!;
    if (b.mats) expect(b.mats).toContain(s.matId);
    for (const a of b.after) expect(s.start).toBeGreaterThanOrEqual(at.get(a.boutId)!.end + a.restMin);
  }
  const byMat = Map.groupBy(schedule, (s) => s.matId);
  for (const list of byMat.values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.start).toBeGreaterThanOrEqual(sorted[i - 1]!.end);
  }
}

describe("buildSchedule", () => {
  it("interleaves two pools on one mat so kids get their rest", () => {
    const timing = { durationMin: 5, restMin: 15 };
    const a = poolScheduleBouts("A:", roundRobin(["a1", "a2", "a3", "a4"]), timing);
    const b = poolScheduleBouts("B:", roundRobin(["b1", "b2", "b3", "b4"]), timing);
    const c = poolScheduleBouts("C:", roundRobin(["c1", "c2", "c3", "c4"]), timing);
    const bouts = [...a, ...b, ...c];
    const { schedule, unscheduled } = buildSchedule(bouts, ["M1"]);
    expect(unscheduled).toEqual([]);
    assertValid(bouts, schedule);
    // 18 bouts x 5 min = 90 min of wrestling; interleaving should leave little idle time.
    const end = Math.max(...schedule.map((s) => s.end));
    expect(end).toBeLessThan(120);
  });

  it("numbers bouts per mat", () => {
    const timing = { durationMin: 5, restMin: 0 };
    const bouts = poolScheduleBouts("A:", roundRobin(["a", "b", "c"]), timing);
    const { schedule } = buildSchedule(bouts, ["M1", "M2"]);
    expect(schedule.map((s) => s.boutNumber)).toEqual(expect.arrayContaining(["101"]));
    expect(schedule.every((s) => /^[12]\d{2}$/.test(s.boutNumber))).toBe(true);
  });

  it("keeps a pool on its assigned mat", () => {
    const timing = { durationMin: 5, restMin: 10 };
    const bouts = [
      ...poolScheduleBouts("A:", roundRobin(["a1", "a2", "a3"]), { ...timing, mats: ["M2"] }),
      ...poolScheduleBouts("B:", roundRobin(["b1", "b2", "b3"]), timing),
    ];
    const { schedule } = buildSchedule(bouts, ["M1", "M2"]);
    assertValid(bouts, schedule);
    expect(schedule.filter((s) => s.boutId.startsWith("A:")).every((s) => s.matId === "M2")).toBe(true);
  });

  it("doesn't give up on a mat whose work is unlocked by another mat", () => {
    const bouts: SchedulableBout[] = [
      { id: "x", priority: 1, durationMin: 30, after: [], mats: ["B"] },
      { id: "y", priority: 2, durationMin: 5, after: [{ boutId: "x", restMin: 10 }], mats: ["A"] },
    ];
    const { schedule, unscheduled } = buildSchedule(bouts, ["A", "B"]);
    expect(unscheduled).toEqual([]);
    expect(schedule.find((s) => s.boutId === "y")).toMatchObject({ matId: "A", start: 40 });
  });

  it("schedules a whole event: brackets and pools over several mats", () => {
    const random = seededRandom(42);
    const bouts: SchedulableBout[] = [];
    for (const [i, n] of [16, 11, 8, 6].entries()) {
      const bracket = doubleElimination(n <= 8 ? 8 : 16, { places: 6 });
      const draw = drawBracket(Array.from({ length: n }, (_, k) => ({ id: `d${i}w${k}` })), { random });
      bouts.push(...bracketScheduleBouts(`D${i}:`, bracket, resolveBracket(bracket, draw), { durationMin: 6, restMin: 30, priorityOffset: i }));
    }
    for (let p = 0; p < 10; p++) {
      bouts.push(...poolScheduleBouts(`P${p}:`, roundRobin([`p${p}a`, `p${p}b`, `p${p}c`, `p${p}d`]), { durationMin: 4, restMin: 15 }));
    }
    const t = performance.now();
    const { schedule, unscheduled } = buildSchedule(bouts, ["M1", "M2", "M3", "M4"]);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(unscheduled).toEqual([]);
    assertValid(bouts, schedule);
  });

  it("reports bouts it can't schedule", () => {
    const { unscheduled } = buildSchedule(
      [
        { id: "a", priority: 1, durationMin: 5, after: [{ boutId: "ghost", restMin: 0 }] },
        { id: "b", priority: 1, durationMin: 5, after: [{ boutId: "a", restMin: 0 }] },
        { id: "c", priority: 1, durationMin: 5, after: [], mats: ["M9"] },
      ],
      ["M1"],
    );
    expect(unscheduled.map((u) => u.boutId).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("estimateMatTimes", () => {
  it("labels now / on deck / in the hole and flags rest holds", () => {
    const est = estimateMatTimes(
      [
        {
          matId: "M1",
          current: { boutId: "b1", startedAt: 0, durationMin: 6 },
          queue: [
            { boutId: "b2", durationMin: 6, after: [] },
            { boutId: "b3", durationMin: 6, after: [{ boutId: "b1", restMin: 15 }] },
            { boutId: "b4", durationMin: 6, after: [] },
          ],
        },
        { matId: "M2", queue: [{ boutId: "c1", durationMin: 5, after: [] }] },
      ],
      new Map(),
      2,
    );
    const by = new Map(est.map((e) => [e.boutId, e]));
    expect(by.get("b1")!.position).toBe("wrestling");
    expect(by.get("b2")).toMatchObject({ position: "on-deck", estimatedStart: 6 });
    expect(by.get("b3")).toMatchObject({ position: "in-the-hole", estimatedStart: 21, restHoldUntil: 21 });
    expect(by.get("b4")).toMatchObject({ position: "queued", estimatedStart: 27 });
    expect(by.get("c1")).toMatchObject({ position: "on-deck", estimatedStart: 2 });
  });

  it("uses cross-mat dependencies", () => {
    const est = estimateMatTimes(
      [
        { matId: "M1", queue: [{ boutId: "x", durationMin: 10, after: [] }] },
        { matId: "M2", queue: [{ boutId: "y", durationMin: 5, after: [{ boutId: "x", restMin: 30 }] }] },
      ],
      new Map(),
      0,
    );
    expect(est.find((e) => e.boutId === "y")!.estimatedStart).toBe(40);
  });
});

describe("durations and mat balancing", () => {
  it("estimates bout length", () => {
    // USAW 8U 1-1-1: 3 x 60s + 2 x 30s breaks = 4 min + 2 min overhead.
    expect(estimateBoutMinutes([60, 60, 60])).toBe(6);
    expect(rollingAverage([], 6)).toBe(6);
    expect(rollingAverage([4, 5, 6], 6)).toBe(5);
  });

  it("balances groups across mats", () => {
    const groups = [30, 30, 24, 24, 18, 18, 12, 12].map((m, i) => ({ id: `g${i}`, minutes: m }));
    const assignment = assignGroupsToMats(groups, ["M1", "M2"]);
    const load = (mat: string) => groups.filter((g) => assignment.get(g.id) === mat).reduce((a, g) => a + g.minutes, 0);
    expect(load("M1")).toBe(load("M2"));
  });
});
