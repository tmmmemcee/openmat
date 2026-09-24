import { describe, expect, it } from "vitest";
import { matQueues } from "../src/services/live.js";
import type { BoutView, BracketView } from "../src/services/tournament.js";

const bout = (id: string, order: number, extra: Partial<BoutView> = {}): BoutView => ({
  id,
  bracketId: "br",
  key: id,
  round: 1,
  label: "",
  section: "pool",
  a: "x",
  b: "y",
  status: "ready",
  mat: 1,
  matOrder: order,
  boutNumber: String(100 + order),
  plannedStartMin: 0,
  durationMin: 6,
  after: [],
  startedAt: null,
  endedAt: null,
  winnerEntryId: null,
  result: null,
  ...extra,
});

const view = (bouts: BoutView[]): BracketView[] => [
  { id: "br", divisionId: "d", groupId: null, weightClass: null, name: "B", format: "round-robin", options: {}, size: null, draw: [], bouts, places: [] },
];

describe("mat estimates", () => {
  const now = new Date("2027-01-09T15:00:00Z");
  const at = (min: number) => new Date(now.getTime() + min * 60000);

  it("spaces queued bouts by the mat's pace even when results were entered instantly", () => {
    // Result-only entries: started and ended at the same moment, 5 minutes apart.
    const done = [0, 1, 2].map((i) => bout(`d${i}`, i + 1, { status: "done", startedAt: at(-15 + i * 5), endedAt: at(-15 + i * 5), winnerEntryId: "x" }));
    const queue = [bout("q1", 4), bout("q2", 5), bout("q3", 6)];
    const items = matQueues(view([...done, ...queue]), 1, now).get(1)!;
    const starts = items.map((i) => new Date(i.estimatedStart!).getTime());
    expect(starts[1]! - starts[0]!).toBe(5 * 60000);
    expect(starts[2]! - starts[1]!).toBe(5 * 60000);
  });

  it("uses the planned length until there's a pace to go on", () => {
    const items = matQueues(view([bout("q1", 1), bout("q2", 2)]), 1, now).get(1)!;
    expect(new Date(items[1]!.estimatedStart!).getTime() - new Date(items[0]!.estimatedStart!).getTime()).toBe(6 * 60000);
  });
});
