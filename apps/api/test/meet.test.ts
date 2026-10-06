import { describe, expect, it } from "vitest";
import { app, auth, createEvent } from "./helpers.js";

const meetEvent = {
  name: "Eagles vs Hawks Scratch Dual",
  startDate: "2026-12-05",
  format: "meet",
  rulesetId: "usaw-kids-folkstyle-2025-26",
  settings: { mats: 2, registrationOpen: true, meet: { matchesPerKid: 2 } },
  divisions: ["8U", "10U", "12U"].map((age, i) => ({ name: `${age} Boys`, ageDivision: age, maxAge: 8 + i * 2, gender: "boys", periodsSec: [60, 60, 60] })),
};

async function setup() {
  const ev = await createEvent(meetEvent);
  const h = auth(ev.directorToken);
  const add = async (firstName: string, team: string, declaredWeight: number | null, birthYear = 2017) => {
    const res = await app.inject({ method: "POST", url: `/api/events/${ev.slug}/entries`, headers: h, payload: { firstName, lastName: team, team, birthYear, gender: "boys", declaredWeight } });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
  };
  const ids = {
    e1: await add("E1", "Eagles", 50),
    e2: await add("E2", "Eagles", 53),
    e3: await add("E3", "Eagles", 56),
    h1: await add("H1", "Hawks", 51),
    h2: await add("H2", "Hawks", 54),
    h3: await add("H3", "Hawks", 57),
    big: await add("Big", "Hawks", 95),
    none: await add("NoWeight", "Eagles", null),
  };
  const call = (method: "GET" | "POST" | "DELETE", path: string, payload?: object) =>
    app.inject({ method, url: `/api/events/${ev.slug}${path}`, headers: h, ...(payload ? { payload } : {}) });
  return { ...ev, h, ids, call };
}

describe("scratch meets", () => {
  it("pairs across teams from coach weights and explains who is short", async () => {
    const s = await setup();
    expect((await s.call("POST", "/pairings/auto")).json()).toEqual({ added: 6, short: 1 });
    const board = (await s.call("GET", "/pairings")).json();
    expect(board.pairings).toHaveLength(6);
    const teamOf = new Map(board.wrestlers.map((w: { id: string; team: string }) => [w.id, w.team]));
    for (const p of board.pairings) expect(teamOf.get(p.a)).not.toBe(teamOf.get(p.b));
    for (const id of [s.ids.e1, s.ids.e2, s.ids.e3, s.ids.h1, s.ids.h2, s.ids.h3]) {
      expect(board.wrestlers.find((w: { id: string }) => w.id === id).matches).toBe(2);
    }
    const reasons = Object.fromEntries(board.short.map((x: { entryId: string; reason: string }) => [x.entryId, x.reason]));
    expect(reasons[s.ids.big]).toMatch(/No one on another team/);
    expect(reasons[s.ids.none]).toMatch(/Needs a weight/);
    // Weight source is shown: coach-supplied until a weigh-in.
    expect(board.wrestlers.find((w: { id: string }) => w.id === s.ids.e1).weightSource).toBe("coach");

    // Running it again doesn't duplicate anything.
    expect((await s.call("POST", "/pairings/auto")).json().added).toBe(0);
  });

  it("hand pairing: outside limits needs force; remove; public view has names but no ratings", async () => {
    const s = await setup();
    const tooBig = await s.call("POST", "/pairings", { a: s.ids.e3, b: s.ids.big });
    expect(tooBig.statusCode).toBe(409);
    expect(tooBig.json().error).toMatch(/apart in weight/);
    const teammates = await s.call("POST", "/pairings", { a: s.ids.e1, b: s.ids.e2 });
    expect(teammates.json().error).toMatch(/Same team/);
    const forced = await s.call("POST", "/pairings", { a: s.ids.e3, b: s.ids.big, force: true });
    expect(forced.statusCode).toBe(201);
    expect((await s.call("POST", "/pairings", { a: s.ids.big, b: s.ids.e3 })).statusCode).toBe(409);
    const board = (await s.call("GET", "/pairings")).json();
    expect(board.pairings[0].flags[0]).toMatch(/apart in weight/);

    const pub = (await app.inject({ url: `/api/events/${s.slug}/brackets` })).json();
    expect(pub.brackets[0].format).toBe("pairings");
    expect(pub.wrestlers.map((w: { firstName: string }) => w.firstName).sort()).toEqual(["Big", "E3"]);

    expect((await s.call("DELETE", `/pairings/${forced.json().boutId}`)).statusCode).toBe(200);
    expect((await s.call("GET", "/pairings")).json().pairings).toEqual([]);
    expect((await app.inject({ url: `/api/events/${s.slug}/pairings` })).statusCode).toBe(401);
  });

  it("schedules, scores and keeps a dual meet team score", async () => {
    const s = await setup();
    await s.call("POST", "/pairings/auto");
    expect((await s.call("POST", "/brackets/generate", {})).statusCode).toBe(400);
    const sched = (await s.call("POST", "/brackets/schedule", {})).json();
    expect(sched.scheduled).toBe(6);
    const bouts = (await app.inject({ url: `/api/events/${s.slug}/brackets` })).json().brackets[0].bouts;
    // Everyone's first match comes before anyone's second.
    expect(bouts.slice(0, 3).every((b: { label: string }) => b.label === "Match 1")).toBe(true);
    const [first] = bouts;
    await s.call("POST", `/bouts/${first.id}/finish`, { mode: "manual", winner: "A", winType: "FALL", matchTimeSec: 40 });
    const scores = (await app.inject({ url: `/api/events/${s.slug}/team-scores` })).json();
    expect(scores.kind).toBe("meet");
    const winnerTeam = first.a === s.ids.e1 || first.a === s.ids.e2 || first.a === s.ids.e3 ? "Eagles" : "Hawks";
    expect(scores.teams[0]).toMatchObject({ team: winnerTeam, wins: 1 });
    expect(scores.teams[0].points).toBeGreaterThan(0);
    expect(scores.duals).toHaveLength(1);

    // Once wrestled, a match can't be removed, and "start over" keeps it.
    expect((await s.call("DELETE", `/pairings/${first.id}`)).statusCode).toBe(409);
    await s.call("POST", "/pairings/auto", { replace: true });
    const after = (await s.call("GET", "/pairings")).json().pairings;
    expect(after.find((p: { boutId: string }) => p.boutId === first.id)?.status).toBe("done");
    expect(after).toHaveLength(6);
  });
});
