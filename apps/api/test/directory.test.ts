import { describe, expect, it } from "vitest";
import { app, auth, createEvent, mailer, youthEvent } from "./helpers.js";

const nextYear = new Date().getFullYear() + 1;
const make = (overrides: object) => createEvent({ ...youthEvent, ...overrides });

describe("tournament list", () => {
  it("lists upcoming listed events with filters", async () => {
    await make({ name: "Hawks Holiday Open", startDate: `${nextYear}-01-10`, startTime: "09:00", city: "Des Moines", state: "ia" });
    await make({ name: "Prairie Kids Classic", startDate: `${nextYear}-02-14`, city: "Omaha", state: "NE" });
    await make({ name: "Secret Scrimmage", startDate: `${nextYear}-01-11`, state: "IA", listed: false });
    await make({ name: "Last Year's Open", startDate: "2020-01-01", state: "IA" });

    const list = async (qs = "") => (await app.inject({ url: `/api/events${qs}` })).json();
    const all = await list();
    expect(all.events.map((e: { name: string }) => e.name)).toEqual(["Hawks Holiday Open", "Prairie Kids Classic"]);
    expect(all.states).toEqual(["IA", "NE"]);
    expect(all.events[0]).toMatchObject({ startTime: "09:00", city: "Des Moines", state: "IA", format: "madison", wrestlers: 0 });
    expect(all.events[0].divisions).toContain("10U Boys");

    expect((await list("?state=NE")).events).toHaveLength(1);
    expect((await list("?q=hawks")).events).toHaveLength(1);
    expect((await list("?q=omaha")).events).toHaveLength(1);
    expect((await list(`?to=${nextYear}-01-31`)).events).toHaveLength(1);
    expect((await list("?format=weight-classes")).events).toHaveLength(0);
    expect((await list("?open=true")).events).toHaveLength(0);
    expect((await list("?q=100%25")).events).toHaveLength(0); // wildcards are escaped
  });

  it("shows registration-open events when asked", async () => {
    const { slug, directorToken } = await make({ startDate: `${nextYear}-03-01` });
    await app.inject({ method: "PATCH", url: `/api/events/${slug}`, headers: auth(directorToken), payload: { settings: { registrationOpen: true } } });
    const res = (await app.inject({ url: "/api/events?open=true" })).json();
    expect(res.events.map((e: { slug: string }) => e.slug)).toEqual([slug]);
  });
});

describe("lost director link", () => {
  it("emails the link at creation and again on request, and the new link works", async () => {
    const { slug } = await make({ directorEmail: "Coach@Example.com" });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe("coach@example.com");
    expect(mailer.sent[0]!.text).toContain(`/e/${slug}/manage#k=`);

    const res = await app.inject({ method: "POST", url: "/api/recover", payload: { email: "coach@example.com" } });
    expect(res.json()).toEqual({ ok: true });
    const token = mailer.sent[1]!.text.match(/#k=([\w-]+)/)![1]!;
    const info = (await app.inject({ url: `/api/events/${slug}`, headers: auth(token) })).json();
    expect(info.access.role).toBe("director");
    expect(info.directorEmail).toBe("coach@example.com");
  });

  it("answers the same for unknown emails and sends nothing", async () => {
    await make({ directorEmail: "coach@example.com" });
    mailer.sent.length = 0;
    const res = await app.inject({ method: "POST", url: "/api/recover", payload: { email: "someone@else.com" } });
    expect(res.json()).toEqual({ ok: true });
    expect(mailer.sent).toHaveLength(0);
  });

  it("hides the director email from the public", async () => {
    const { slug } = await make({ directorEmail: "coach@example.com" });
    const pub = (await app.inject({ url: `/api/events/${slug}` })).json();
    expect(pub.directorEmail).toBeUndefined();
  });

  it("limits repeated requests", async () => {
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await app.inject({ method: "POST", url: "/api/recover", payload: { email: "spam@example.com" } })).statusCode;
    expect(last).toBe(429);
  });
});

describe("team roster registration", () => {
  const roster = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ firstName: `Kid${i}`, lastName: "Roster", birthYear: 2017, gender: "boys", team: "ignored" }));

  it("lets a coach register a whole team while registration is open", async () => {
    const { slug, directorToken } = await make({});
    const submit = (payload: object) => app.inject({ method: "POST", url: `/api/events/${slug}/entries/import`, payload });
    expect((await submit({ team: "Hawks", rows: roster(3) })).statusCode).toBe(403);

    await app.inject({ method: "PATCH", url: `/api/events/${slug}`, headers: auth(directorToken), payload: { settings: { registrationOpen: true } } });
    const ok = await submit({ team: "Hawks", contactEmail: "coach@hawks.org", rows: [...roster(3), { firstName: "No", lastName: "Year" }] });
    expect(ok.json()).toMatchObject({ created: 3, errors: [{ row: 4 }] });
    const list = (await app.inject({ url: `/api/events/${slug}/entries`, headers: auth(directorToken) })).json();
    expect(list.every((e: { team: string; contactEmail: string }) => e.team === "Hawks" && e.contactEmail === "coach@hawks.org")).toBe(true);

    expect((await submit({ team: "", rows: roster(1) })).json().error).toContain("team name");
    expect((await submit({ team: "Big", rows: roster(151) })).statusCode).toBe(400);
  });
});
