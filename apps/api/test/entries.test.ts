import { describe, expect, it } from "vitest";
import { app, auth, createEvent } from "./helpers.js";

const kid = (first: string, birthYear: number, gender = "boys", extra: object = {}) => ({
  firstName: first,
  lastName: "Smith",
  team: "Hawks",
  birthYear,
  gender,
  ...extra,
});

describe("entries", () => {
  it("places a wrestler in their age group from birth year", async () => {
    const { slug, directorToken, info } = await createEvent();
    const res = await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, headers: auth(directorToken), payload: kid("Sam", 2018) });
    expect(res.statusCode).toBe(201);
    // Season 2027: born 2018 is 9 -> 10U.
    const division = info.divisions.find((d: { id: string }) => d.id === res.json().divisionId);
    expect(division.name).toBe("10U Boys");
  });

  it("rejects duplicates and wrestlers too old for every age group", async () => {
    const { slug, directorToken } = await createEvent();
    await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, headers: auth(directorToken), payload: kid("Sam", 2018) });
    const dup = await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, headers: auth(directorToken), payload: kid("sam", 2018) });
    expect(dup.statusCode).toBe(409);
    const old = await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, headers: auth(directorToken), payload: kid("Max", 2010) });
    expect(old.statusCode).toBe(400);
    expect(old.json().error).toContain("No age group");
  });

  it("public registration only while open", async () => {
    const { slug, directorToken } = await createEvent();
    const closed = await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, payload: kid("Sam", 2018) });
    expect(closed.statusCode).toBe(403);
    await app.inject({ method: "PATCH", url: `/api/events/${slug}`, headers: auth(directorToken), payload: { settings: { registrationOpen: true } } });
    const open = await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, payload: kid("Sam", 2018) });
    expect(open.statusCode).toBe(201);
    expect(open.json()).toEqual({ id: expect.any(String), division: "10U Boys" });
  });

  it("imports good rows and reports bad ones", async () => {
    const { slug, directorToken } = await createEvent();
    const res = await app.inject({
      method: "POST",
      url: `/api/events/${slug}/entries/import`,
      headers: auth(directorToken),
      payload: { rows: [kid("A", 2018), kid("B", 2016), { firstName: "C" }, kid("A", 2018), kid("D", 2005)] },
    });
    const body = res.json();
    expect(body.created).toBe(2);
    expect(body.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5]);
  });

  it("weigh-in records weight, and that link can't do anything else", async () => {
    const { slug, directorToken, weighInToken } = await createEvent();
    const { id } = (await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, headers: auth(directorToken), payload: kid("Sam", 2018) })).json();
    const weighed = await app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${id}`, headers: auth(weighInToken), payload: { weight: 61.4 } });
    expect(weighed.json()).toMatchObject({ weight: 61.4, status: "weighed-in" });
    expect(weighed.json().weighedAt).toBeTruthy();
    const sneaky = await app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${id}`, headers: auth(weighInToken), payload: { bumpAge: 1 } });
    expect(sneaky.statusCode).toBe(403);
  });

  it("allows bumping up but never down, and only when an older group exists", async () => {
    const { slug, directorToken } = await createEvent();
    const young = (await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, headers: auth(directorToken), payload: kid("Sam", 2020) })).json();
    const patch = (payload: object) => app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${young.id}`, headers: auth(directorToken), payload });
    expect((await patch({ bumpAge: 1 })).statusCode).toBe(200);
    expect((await patch({ bumpAge: -1 })).json().error).toContain("never down");
    const oldest = (await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, headers: auth(directorToken), payload: kid("Max", 2015) })).json();
    const r = await app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${oldest.id}`, headers: auth(directorToken), payload: { bumpAge: 1 } });
    expect(r.json().error).toContain("no older age group");
  });
});

describe("weight class events", () => {
  const hsEvent = {
    name: "County Duals",
    startDate: "2027-01-09",
    format: "weight-classes",
    rulesetId: "nfhs-2025-26",
    divisions: [{ name: "High School Boys", gender: "boys", weightClasses: [106, 113, 120, 126], periodsSec: [120, 120, 120] }],
  };

  it("checks weigh-ins against the entered class", async () => {
    const { slug, directorToken, weighInToken } = await createEvent(hsEvent);
    const e = (await app.inject({
      method: "POST",
      url: `/api/events/${slug}/entries`,
      headers: auth(directorToken),
      payload: { firstName: "Jo", lastName: "Lee", team: "North", weightClass: "113" },
    })).json();
    const missed = await app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${e.id}`, headers: auth(weighInToken), payload: { weight: 113.6 } });
    expect(missed.json().weighIn).toMatchObject({ status: "missed-weight", suggested: { name: "120" } });
    const moved = await app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${e.id}`, headers: auth(weighInToken), payload: { weightClass: "120" } });
    expect(moved.json().weighIn).toMatchObject({ status: "ok" });
    const bad = await app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${e.id}`, headers: auth(weighInToken), payload: { weightClass: "150" } });
    expect(bad.statusCode).toBe(400);
  });
});
