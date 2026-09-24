import { describe, expect, it } from "vitest";
import { NFHS_TEAM_SCORING, teamScores } from "../src/index.js";

const team: Record<string, string> = { a: "Hawks", b: "Owls", c: "Hawks", d: "Owls" };

describe("team scores", () => {
  it("adds advancement, bonus and placement points", () => {
    // 4-man bracket: a pins b (semi), c beats d by major (semi), a decisions c in the final (1st/2nd), d beats b for 3rd.
    const scores = teamScores(
      [
        {
          bouts: [
            { key: "W1-1", section: "championship", status: "done", winner: "a", winType: "FALL", winnerTo: "W2-1" },
            { key: "W1-2", section: "championship", status: "done", winner: "c", winType: "MD", winnerTo: "W2-1" },
            { key: "W2-1", section: "championship", status: "done", winner: "a", winType: "DEC", winnerTo: null },
            { key: "L1-1", section: "placement", status: "done", winner: "d", winType: "DEC", winnerTo: null },
          ],
          places: [
            { place: 1, entryId: "a" },
            { place: 2, entryId: "c" },
            { place: 3, entryId: "d" },
            { place: 4, entryId: "b" },
          ],
        },
      ],
      (id) => team[id],
    );
    // Hawks: a adv 2 + fall 2 + 1st 16; c adv 2 + major 1 + 2nd 12 => 35
    // Owls: d 3rd 9; b 4th 7 => 16
    expect(scores).toEqual([
      { team: "Hawks", points: 35, advancement: 4, bonus: 3, placement: 28, wrestlers: 2 },
      { team: "Owls", points: 16, advancement: 0, bonus: 0, placement: 16, wrestlers: 2 },
    ]);
  });

  it("counts a bye followed by a win", () => {
    const scores = teamScores(
      [
        {
          bouts: [
            { key: "W1-1", section: "championship", status: "bye", winner: "a", winnerTo: "W2-1" },
            { key: "W2-1", section: "championship", status: "done", winner: "a", winType: "DEC", winnerTo: "W3-1" },
          ],
          places: [],
        },
      ],
      (id) => team[id],
    );
    expect(scores[0]).toMatchObject({ team: "Hawks", advancement: 4 });
  });

  it("round robins get bonus and placement only, and scoring is adjustable", () => {
    const scores = teamScores(
      [{ bouts: [{ key: "1", section: "pool", status: "done", winner: "b", winType: "TF" }], places: [{ place: 1, entryId: "b" }] }],
      (id) => team[id],
      { ...NFHS_TEAM_SCORING, placePoints: [10] },
    );
    expect(scores).toEqual([{ team: "Owls", points: 11.5, advancement: 0, bonus: 1.5, placement: 10, wrestlers: 1 }]);
  });
});
