import { describe, expect, it } from "vitest";
import {
  type BoutEvent,
  type Corner,
  NCAA_2025_27,
  NFHS_2025_26,
  RULESETS,
  UWW_FREESTYLE_2025,
  UWW_GRECO_2025,
  boutState,
  clock,
  finalizeBout,
  manualOutcome,
} from "../src/index.js";

let n = 0;
const s = (corner: Corner, action: string, matchTimeSec?: number): BoutEvent => ({
  id: `e${++n}`,
  type: "score",
  corner,
  action,
  ...(matchTimeSec !== undefined ? { matchTimeSec } : {}),
});
const pen = (corner: Corner, kind: string, points?: number): BoutEvent => ({
  id: `e${++n}`,
  type: "penalty",
  corner,
  kind,
  ...(points !== undefined ? { points } : {}),
});
const voidOf = (target: BoutEvent): BoutEvent => ({ id: `e${++n}`, type: "void", target: target.id, reason: "wrong wrestler" });

describe("folkstyle (NFHS)", () => {
  it("scores takedowns, escapes, reversals and near falls", () => {
    const st = boutState(NFHS_2025_26, [s("A", "T3"), s("A", "N3"), s("B", "E1"), s("B", "R2")]);
    expect(st.score).toEqual({ A: 6, B: 3 });
  });

  it("decision, major decision and their team points", () => {
    const dec = finalizeBout(NFHS_2025_26, [s("A", "T3"), s("B", "E1")], { type: "time" });
    expect(dec).toMatchObject({ ok: true, outcome: { winner: "A", winType: "DEC", summary: "Dec 3-1", teamPoints: 3 } });
    const md = finalizeBout(NFHS_2025_26, [s("B", "T3"), s("B", "N4"), s("B", "T3")], { type: "time" });
    expect(md).toMatchObject({ ok: true, outcome: { winner: "B", winType: "MD", summary: "MD 10-0", teamPoints: 4 } });
  });

  it("detects a technical fall at 15 and records the time", () => {
    const events = [s("A", "T3", 20), s("A", "N4", 30), s("A", "T3", 70), s("A", "N4", 85), s("B", "E1", 100), s("A", "T3", 130)];
    // 17-1: margin 16, reached on the last takedown.
    const st = boutState(NFHS_2025_26, events);
    expect(st.techFall).toEqual({ winner: "A", eventId: events[5]!.id });
    const r = finalizeBout(NFHS_2025_26, events, { type: "tech-fall" });
    expect(r).toMatchObject({ ok: true, outcome: { winType: "TF", summary: "TF 17-1 (2:10)", teamPoints: 5 } });
  });

  it("refuses a tech fall that isn't there", () => {
    expect(finalizeBout(NFHS_2025_26, [s("A", "T3")], { type: "tech-fall" })).toMatchObject({ ok: false, reason: "no-tech-fall" });
  });

  it("records a fall with its time", () => {
    const r = finalizeBout(NFHS_2025_26, [s("A", "T3", 40)], { type: "fall", winner: "A", matchTimeSec: 96 });
    expect(r).toMatchObject({ ok: true, outcome: { winType: "FALL", summary: "F 1:36", teamPoints: 6 } });
  });

  it("sends a tie to overtime", () => {
    const r = finalizeBout(NFHS_2025_26, [s("A", "T3"), s("B", "T3")], { type: "time" });
    expect(r).toMatchObject({ ok: false, reason: "tied" });
  });

  it("follows the stalling progression: warning, 1, 1, 2, DQ", () => {
    const calls = [pen("B", "stalling"), pen("B", "stalling"), pen("B", "stalling"), pen("B", "stalling")];
    const st = boutState(NFHS_2025_26, calls);
    expect(st.score).toEqual({ A: 4, B: 0 });
    expect(st.warnings).toHaveLength(1);
    const withFifth = [...calls, pen("B", "stalling")];
    expect(boutState(NFHS_2025_26, withFifth).disqualified).toBe("B");
    expect(finalizeBout(NFHS_2025_26, withFifth, { type: "time" })).toMatchObject({ ok: true, outcome: { winner: "A", winType: "DQ" } });
  });

  it("counts technical violations and illegal holds together", () => {
    const st = boutState(NFHS_2025_26, [pen("A", "technical"), pen("A", "illegal-hold"), pen("A", "roughness")]);
    expect(st.score.B).toBe(1 + 1 + 2);
    expect(boutState(NFHS_2025_26, [pen("A", "technical"), pen("A", "illegal-hold"), pen("A", "roughness"), pen("A", "technical")]).disqualified).toBe("A");
  });

  it("undoes and corrects with voids, keeping the history", () => {
    const td = s("A", "T3");
    const fixed = s("B", "T3");
    const events = [td, voidOf(td), fixed];
    expect(boutState(NFHS_2025_26, events).score).toEqual({ A: 0, B: 3 });
    // Voiding the void restores the original.
    const undoVoid: BoutEvent = { id: "uv", type: "void", target: events[1]!.id };
    expect(boutState(NFHS_2025_26, [...events, undoVoid]).score).toEqual({ A: 3, B: 3 });
  });

  it("reports bad entries instead of crashing", () => {
    const st = boutState(NFHS_2025_26, [s("A", "T2"), { id: "v", type: "void", target: "nope" }]);
    expect(st.errors).toHaveLength(2);
  });

  it("uses the pinned ruleset only: youth kids folkstyle scores like NFHS", () => {
    const kids = RULESETS.find((r) => r.id === "usaw-kids-folkstyle-2025-26")!;
    expect(boutState(kids, [s("A", "T3"), s("A", "N2")]).score.A).toBe(5);
    expect(kids.periodsSec).toEqual([60, 60, 60]);
    expect(kids.minRestMin).toBe(15);
  });
});

describe("folkstyle (NCAA riding time)", () => {
  it("adds a riding time point at the end", () => {
    const events: BoutEvent[] = [s("A", "T3"), s("B", "E1"), s("B", "T3"), { id: "rt", type: "riding-time", corner: "A", seconds: 75 }];
    // 3-4 before riding time; the point ties it.
    expect(finalizeBout(NCAA_2025_27, events, { type: "time" })).toMatchObject({ ok: false, reason: "tied" });
    const short: BoutEvent[] = [...events, { id: "rt2", type: "riding-time", corner: "A", seconds: 59 }];
    expect(finalizeBout(NCAA_2025_27, short, { type: "time" })).toMatchObject({ ok: true, outcome: { winner: "B", summary: "Dec 4-3" } });
  });

  it("counts the riding time point toward a tech fall", () => {
    const events: BoutEvent[] = [s("A", "T3"), s("A", "N4"), s("A", "T3"), s("A", "N4"), { id: "rt", type: "riding-time", corner: "A", seconds: 200 }];
    expect(finalizeBout(NCAA_2025_27, events, { type: "time" })).toMatchObject({ ok: true, outcome: { winType: "TF", score: { A: 15, B: 0 } } });
  });
});

describe("freestyle and Greco (UWW)", () => {
  it("ends freestyle at 10 and Greco at 8, VSU vs VSU1", () => {
    const fs = [s("A", "T2"), s("A", "4"), s("A", "2"), s("A", "T2")];
    expect(boutState(UWW_FREESTYLE_2025, fs).techFall?.winner).toBe("A");
    expect(finalizeBout(UWW_FREESTYLE_2025, fs, { type: "tech-fall" })).toMatchObject({
      ok: true,
      outcome: { winType: "VSU", classificationPoints: [4, 0], summary: "VSU 10-0" },
    });
    const gr = [s("B", "1"), s("A", "4"), s("A", "4"), s("A", "1")];
    expect(finalizeBout(UWW_GRECO_2025, gr, { type: "tech-fall" })).toMatchObject({
      ok: true,
      outcome: { winType: "VSU1", classificationPoints: [4, 1], summary: "VSU1 9-1" },
    });
  });

  it("VPO vs VPO1 depends on whether the loser scored technical points", () => {
    expect(finalizeBout(UWW_FREESTYLE_2025, [s("A", "T2"), s("B", "P1")], { type: "time" })).toMatchObject({
      ok: true,
      outcome: { winType: "VPO", classificationPoints: [3, 0] },
    });
    expect(finalizeBout(UWW_FREESTYLE_2025, [s("A", "T2"), s("A", "1"), s("B", "1")], { type: "time" })).toMatchObject({
      ok: true,
      outcome: { winType: "VPO1", summary: "VPO1 3-1" },
    });
  });

  it("breaks ties by highest-value hold, then count, then cautions, then last point", () => {
    const f = (events: BoutEvent[]) => finalizeBout(UWW_FREESTYLE_2025, events, { type: "time" });
    expect(f([s("A", "4"), s("B", "T2"), s("B", "T2")])).toMatchObject({ outcome: { winner: "A", decidedBy: "highest-value" } });
    expect(f([s("A", "T2"), s("A", "T2"), s("B", "T2"), s("B", "1"), s("B", "1")])).toMatchObject({
      outcome: { winner: "A", decidedBy: "most-highest-value" },
    });
    // 2-2 each with one takedown; A got a point from B's caution... keep it even: both 3, B has a caution.
    expect(f([s("A", "T2"), pen("B", "caution"), s("B", "T2"), s("B", "1")])).toMatchObject({
      outcome: { winner: "A", decidedBy: "fewest-cautions" },
    });
    expect(f([s("A", "T2"), s("B", "T2")])).toMatchObject({ outcome: { winner: "B", decidedBy: "last-technical-point" } });
  });

  it("loses the bout on three cautions", () => {
    const events = [pen("A", "caution"), pen("A", "caution", 2), s("A", "4"), pen("A", "caution")];
    const st = boutState(UWW_FREESTYLE_2025, events);
    expect(st.score).toEqual({ A: 4, B: 4 });
    expect(st.cautionedOut).toBe("A");
    expect(finalizeBout(UWW_FREESTYLE_2025, events, { type: "time" })).toMatchObject({
      ok: true,
      outcome: { winner: "B", winType: "VCA", classificationPoints: [5, 0] },
    });
  });
});

describe("ruleset data", () => {
  it("every ruleset is complete and linked to its rule book", () => {
    for (const r of RULESETS) {
      expect(r.links.length).toBeGreaterThan(0);
      expect(r.summary.length).toBeGreaterThan(20);
      expect(new Set(r.actions.map((a) => a.code)).size).toBe(r.actions.length);
      for (const p of r.penalties) for (const k of p.sharedWith ?? []) expect(r.penalties.map((x) => x.kind)).toContain(k);
    }
  });

  it("formats clock time", () => {
    expect(clock(96)).toBe("1:36");
    expect(clock(5)).toBe("0:05");
  });
});

describe("result-only entry", () => {
  it("accepts results that match the rules and writes the score sheet text", () => {
    expect(manualOutcome(NFHS_2025_26, { winner: "A", winType: "DEC", score: { A: 7, B: 3 } })).toMatchObject({ ok: true, outcome: { summary: "Dec 7-3", teamPoints: 3 } });
    expect(manualOutcome(NFHS_2025_26, { winner: "B", winType: "FALL", matchTimeSec: 83 })).toMatchObject({ ok: true, outcome: { summary: "F 1:23", teamPoints: 6 } });
    expect(manualOutcome(NFHS_2025_26, { winner: "A", winType: "FOR" })).toMatchObject({ ok: true, outcome: { summary: "For." } });
    expect(manualOutcome(UWW_FREESTYLE_2025, { winner: "A", winType: "VSU1", score: { A: 12, B: 2 } })).toMatchObject({ ok: true, outcome: { classificationPoints: [4, 1] } });
  });

  it("catches results that don't add up", () => {
    expect(manualOutcome(NFHS_2025_26, { winner: "A", winType: "DEC", score: { A: 12, B: 3 } })).toMatchObject({ ok: false, message: expect.stringContaining("major") });
    expect(manualOutcome(NFHS_2025_26, { winner: "A", winType: "MD", score: { A: 3, B: 5 } })).toMatchObject({ ok: false, message: expect.stringContaining("higher score") });
    expect(manualOutcome(NFHS_2025_26, { winner: "A", winType: "TF", score: { A: 14, B: 0 } })).toMatchObject({ ok: false });
    expect(manualOutcome(NFHS_2025_26, { winner: "A", winType: "DEC" })).toMatchObject({ ok: false, message: "Enter the final score." });
    expect(manualOutcome(NFHS_2025_26, { winner: "A", winType: "VPO" })).toMatchObject({ ok: false });
    expect(manualOutcome(UWW_GRECO_2025, { winner: "A", winType: "VPO", score: { A: 3, B: 1 } })).toMatchObject({ ok: false });
  });
});
