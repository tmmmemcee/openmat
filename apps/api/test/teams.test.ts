import { describe, expect, it } from "vitest";
import { app, auth, createEvent, mailer } from "./helpers.js";

const hsEvent = {
  name: "Roster Open",
  startDate: "2027-01-09",
  format: "weight-classes",
  rulesetId: "nfhs-2025-26",
  settings: { mats: 1, registrationOpen: true },
  divisions: [{ name: "HS", gender: "boys", weightClasses: [106], periodsSec: [120, 120, 120] }],
};

async function newTeam(name: string, coachEmail?: string) {
  const res = await app.inject({ method: "POST", url: "/api/teams", payload: { name, ...(coachEmail ? { coachEmail } : {}) } });
  expect(res.statusCode).toBe(201);
  const { id, coachToken } = res.json();
  const h = auth(coachToken);
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", path = "", payload?: object) =>
    app.inject({ method, url: `/api/teams/${id}${path}`, headers: h, ...(payload ? { payload } : {}) });
  return { id, coachToken, h, call };
}

describe("team rosters", () => {
  it("only the coach link can see or change the roster", async () => {
    const t = await newTeam("Eagles WC", "coach@example.com");
    expect(mailer.sent[0]!.text).toContain(`/t/${t.id}#k=${t.coachToken}`);
    expect((await app.inject({ url: `/api/teams/${t.id}` })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/teams/${t.id}`, headers: auth("nope") })).statusCode).toBe(401);
    const other = await newTeam("Hawks");
    expect((await app.inject({ url: `/api/teams/${t.id}`, headers: other.h })).statusCode).toBe(401);
    // Someone else's wrestler can't be edited through your link.
    const w = (await t.call("POST", "/wrestlers", { firstName: "Ann", lastName: "Lee", weight: 60 })).json();
    expect((await other.call("PATCH", `/wrestlers/${w.id}`, { weight: 70 })).statusCode).toBe(404);
  });

  it("seeds the rating from the level until results exist, and imports with per-row errors", async () => {
    const t = await newTeam("Eagles WC");
    const w = (await t.call("POST", "/wrestlers", { firstName: "Ann", lastName: "Lee", level: "novice", weight: 61.4 })).json();
    expect(w.rating).toBe(900);
    expect(w.weightUpdatedAt).toBeTruthy();
    expect((await t.call("PATCH", `/wrestlers/${w.id}`, { level: "advanced" })).json().rating).toBe(1300);

    const imp = (await t.call("POST", "/wrestlers/import", { rows: [{ firstName: "Bo", lastName: "Ray", weight: 70 }, { firstName: "", lastName: "X" }] })).json();
    expect(imp.created).toBe(1);
    expect(imp.errors).toEqual([{ row: 2, message: expect.stringContaining("firstName") }]);

    await t.call("DELETE", `/wrestlers/${w.id}`);
    expect((await t.call("GET")).json().wrestlers.map((x: { firstName: string }) => x.firstName)).toEqual(["Bo"]);
  });
});

describe("register from roster and private ratings", () => {
  async function setup() {
    const ev = await createEvent(hsEvent);
    const eagles = await newTeam("Eagles");
    const hawks = await newTeam("Hawks");
    const ann = (await eagles.call("POST", "/wrestlers", { firstName: "Ann", lastName: "Lee", weight: 105, level: "intermediate" })).json();
    const bea = (await hawks.call("POST", "/wrestlers", { firstName: "Bea", lastName: "Ito", weight: 104, level: "intermediate" })).json();
    for (const [team, w] of [[eagles, ann], [hawks, bea]] as const) {
      const reg = (await team.call("POST", "/register", { eventSlug: ev.slug, wrestlers: [{ wrestlerId: w.id, weightClass: "106" }] })).json();
      expect(reg).toEqual({ created: 1, errors: [] });
    }
    return { ev, eagles, hawks, ann, bea };
  }

  it("registers once, using the team name and latest weight; weigh-ins flow back to the roster", async () => {
    const { ev, eagles, ann } = await setup();
    const again = (await eagles.call("POST", "/register", { eventSlug: ev.slug, wrestlers: [{ wrestlerId: ann.id, weightClass: "106" }] })).json();
    expect(again.created).toBe(0);
    expect(again.errors[0].message).toMatch(/already/i);

    const dir = auth(ev.directorToken);
    const res = await app.inject({ url: `/api/events/${ev.slug}/entries`, headers: dir });
    expect(res.statusCode, res.body).toBe(200);
    const entry = res.json().find((e: { firstName: string }) => e.firstName === "Ann");
    expect(entry.team).toBe("Eagles");
    expect(entry.skill).toMatchObject({ level: "intermediate", rating: 1100 });

    await app.inject({ method: "PATCH", url: `/api/events/${ev.slug}/entries/${entry.id}`, headers: dir, payload: { weight: 105.6 } });
    expect((await eagles.call("GET")).json().wrestlers[0].weight).toBe(105.6);
  });

  it("never shows ratings to the public or weigh-in staff", async () => {
    const { ev } = await setup();
    const weighIn = (await app.inject({ url: `/api/events/${ev.slug}/entries`, headers: auth(ev.weighInToken) })).body;
    const pub = (await app.inject({ url: `/api/events/${ev.slug}/entries` })).body;
    for (const body of [weighIn, pub]) {
      expect(body).not.toContain("rating");
      expect(body).not.toContain("intermediate");
    }
  });

  it("moves ratings on a result, recomputes on a correction, and undoes on a reset", async () => {
    const { ev, eagles, hawks } = await setup();
    const dir = auth(ev.directorToken);
    const list = (await app.inject({ url: `/api/events/${ev.slug}/entries`, headers: dir })).json();
    for (const e of list) await app.inject({ method: "PATCH", url: `/api/events/${ev.slug}/entries/${e.id}`, headers: dir, payload: { weight: 105 } });
    await app.inject({ method: "POST", url: `/api/events/${ev.slug}/brackets/generate`, headers: dir, payload: { format: "single-elim" } });
    const bout = (await app.inject({ url: `/api/events/${ev.slug}/brackets` })).json().brackets[0].bouts.find((b: { a: string; b: string }) => b.a && b.b);
    const finish = (payload: object) => app.inject({ method: "POST", url: `/api/events/${ev.slug}/bouts/${bout.id}/finish`, headers: dir, payload });
    const ratings = async () => [(await eagles.call("GET")).json().wrestlers[0], (await hawks.call("GET")).json().wrestlers[0]];
    const annEntry = list.find((e: { firstName: string }) => e.firstName === "Ann");
    const annCorner = bout.a === annEntry.id ? "A" : "B";
    const beaCorner = annCorner === "A" ? "B" : "A";

    expect((await finish({ mode: "manual", winner: annCorner, winType: "DEC", score: { [annCorner]: 3, [beaCorner]: 1 } })).statusCode).toBe(200);
    let [ann, bea] = await ratings();
    expect(ann.rating).toBe(1124); // even match, provisional K=48 → +24
    expect(bea.rating).toBe(1076);
    expect([ann.ratedMatches, bea.ratedMatches]).toEqual([1, 1]);

    // A correction to a fall replaces the earlier change rather than adding to it.
    await finish({ mode: "manual", winner: annCorner, winType: "FALL", matchTimeSec: 60 });
    [ann, bea] = await ratings();
    expect(ann.rating).toBe(1130);
    expect([ann.ratedMatches, bea.ratedMatches]).toEqual([1, 1]);

    await app.inject({ method: "POST", url: `/api/events/${ev.slug}/bouts/${bout.id}/reset`, headers: dir });
    [ann, bea] = await ratings();
    expect([ann.rating, bea.rating]).toEqual([1100, 1100]);
    expect([ann.ratedMatches, bea.ratedMatches]).toEqual([0, 0]);
  });
});
