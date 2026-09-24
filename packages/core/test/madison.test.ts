import { describe, expect, it } from "vitest";
import { USAW_KIDS_DIVISIONS, groupWrestlers, type GroupingEntry } from "../src/index.js";

let seq = 0;
const kid = (weight: number, division = "10U", extra: Partial<GroupingEntry> = {}): GroupingEntry => ({
  id: `w${++seq}`,
  name: `Kid ${seq}`,
  weight,
  division,
  ...extra,
});

const weights = (g: { members: GroupingEntry[] }) => g.members.map((m) => m.weight);

describe("groupWrestlers", () => {
  it("makes even groups of 4 within 10%", () => {
    const entries = [60, 61, 62, 63, 70, 71, 72, 74].map((w) => kid(w));
    const { groups, unplaced } = groupWrestlers(entries, USAW_KIDS_DIVISIONS);
    expect(unplaced).toEqual([]);
    expect(groups.map(weights)).toEqual([
      [60, 61, 62, 63],
      [70, 71, 72, 74],
    ]);
    expect(groups.every((g) => g.flags.length === 0)).toBe(true);
    expect(groups.map((g) => g.id)).toEqual(["10U-01", "10U-02"]);
  });

  it("keeps age divisions separate", () => {
    const entries = [kid(60, "8U"), kid(61, "8U"), kid(62, "8U"), kid(60, "10U"), kid(61, "10U"), kid(62, "10U")];
    const { groups } = groupWrestlers(entries, USAW_KIDS_DIVISIONS);
    expect(groups.map((g) => g.division)).toEqual(["8U", "10U"]);
    expect(groups.every((g) => g.members.every((m) => m.division === g.division))).toBe(true);
  });

  it("never leaves a kid alone and flags an outlier instead", () => {
    const entries = [60, 61, 62, 63, 64, 65, 90].map((w) => kid(w));
    const { groups } = groupWrestlers(entries, USAW_KIDS_DIVISIONS);
    expect(groups.every((g) => g.members.length > 1)).toBe(true);
    const heavy = groups.find((g) => weights(g).includes(90))!;
    expect(heavy.flags.some((f) => f.type === "weight-spread")).toBe(true);
  });

  it("prefers balanced sizes when tolerance allows", () => {
    // 10 kids tightly packed: 4+3+3 or 3+3+4 (sizes within 3..5), not 5+5 sizes off target.
    const entries = [50, 50.5, 51, 51.5, 52, 52.5, 53, 53.5, 54, 54.5].map((w) => kid(w));
    const sizes = groupWrestlers(entries, USAW_KIDS_DIVISIONS).groups.map((g) => g.members.length);
    expect(sizes.reduce((a, b) => a + b)).toBe(10);
    expect(sizes.every((s) => s >= 3 && s <= 5)).toBe(true);
  });

  it("respects a spread floor for very light kids", () => {
    // 40 -> 44 is 10% (ok). 40 -> 45 is 12.5%, over 10% but within a 5 lb floor.
    const entries = [40, 42, 43, 45].map((w) => kid(w, "8U"));
    const strict = groupWrestlers(entries, USAW_KIDS_DIVISIONS, { minSize: 2, targetSize: 4 });
    const floored = groupWrestlers(entries, USAW_KIDS_DIVISIONS, { minSize: 2, targetSize: 4, spreadFloor: 5 });
    expect(floored.groups).toHaveLength(1);
    expect(floored.groups[0]!.flags).toEqual([]);
    expect(strict.groups.flatMap((g) => g.flags).length + strict.groups.length).toBeGreaterThan(1);
  });

  it("bumps a kid up an age division and flags it", () => {
    const young = kid(62, "8U", { bumpAge: 1 });
    const entries = [young, kid(60), kid(61), kid(63)];
    const { groups } = groupWrestlers(entries, USAW_KIDS_DIVISIONS);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.division).toBe("10U");
    expect(groups[0]!.flags).toContainEqual({ type: "wrestling-up-age", wrestlerId: young.id, from: "8U", to: "10U" });
  });

  it("bumps a kid up a weight group and flags it without counting them in the spread", () => {
    const light = kid(61, "10U", { bumpWeight: 1 });
    const entries = [light, ...[60, 61, 62, 63, 70, 71, 72, 73].map((w) => kid(w))];
    const { groups } = groupWrestlers(entries, USAW_KIDS_DIVISIONS);
    const heavy = groups.find((g) => g.members.some((m) => m.id === light.id))!;
    expect(heavy.number).toBe(2);
    expect(heavy.flags).toContainEqual({ type: "wrestling-up-weight", wrestlerId: light.id, groupsUp: 1 });
    expect(heavy.flags.some((f) => f.type === "weight-spread")).toBe(false);
  });

  it("refuses to move anyone down", () => {
    expect(() => groupWrestlers([kid(60, "10U", { bumpAge: -1 })], USAW_KIDS_DIVISIONS)).toThrow(/never down/);
    expect(() => groupWrestlers([kid(60, "10U", { bumpWeight: -1 })], USAW_KIDS_DIVISIONS)).toThrow(/never down/);
  });

  it("reports kids who can't be bumped instead of dropping them silently", () => {
    const tooOld = kid(100, "14U", { bumpAge: 1 });
    const tooHeavy = kid(80, "10U", { bumpWeight: 1 });
    const { unplaced } = groupWrestlers([tooOld, tooHeavy, kid(79), kid(80), kid(81)], USAW_KIDS_DIVISIONS);
    expect(unplaced.map((u) => [u.entry.id, u.reason])).toEqual([
      [tooOld.id, "no-older-division"],
      [tooHeavy.id, "no-heavier-group"],
    ]);
  });

  it("handles the classic Madison example sizes quickly", () => {
    const entries = Array.from({ length: 1000 }, (_, i) => kid(50 + (i % 200) * 0.5 + (i % 7) * 0.1));
    const t = performance.now();
    const { groups } = groupWrestlers(entries, USAW_KIDS_DIVISIONS);
    expect(performance.now() - t).toBeLessThan(500);
    expect(groups.reduce((n, g) => n + g.members.length, 0)).toBe(1000);
  });
});
