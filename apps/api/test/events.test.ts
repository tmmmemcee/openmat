import { describe, expect, it } from "vitest";
import { app, auth, createEvent, youthEvent } from "./helpers.js";

describe("events", () => {
  it("creates an event with staff links and season year", async () => {
    const { slug, directorToken, info } = await createEvent();
    expect(slug).toMatch(/^[a-z0-9]{6}$/);
    expect(directorToken.length).toBeGreaterThan(20);
    expect(info.seasonYear).toBe(2027); // December 2026 is the 2026-27 season
    expect(info.settings.restMin).toBe(15); // from the USAW kids rule set
    expect(info.access.role).toBe("director");
    expect(info.staffLinks.map((l: { role: string; mat: number | null }) => `${l.role}${l.mat ?? ""}`)).toEqual([
      "table1",
      "table2",
      "weigh-in",
    ]);
  });

  it("shows the public nothing secret", async () => {
    const { slug } = await createEvent();
    const pub = (await app.inject({ url: `/api/events/${slug}` })).json();
    expect(pub.name).toBe("Winter Kids Classic");
    expect(pub.access).toBeNull();
    expect(pub.staffLinks).toBeUndefined();
  });

  it("explains bad input in plain words", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { ...youthEvent, divisions: [{ name: "Kids", gender: "boys", periodsSec: [60] }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("needs an age group");
  });

  it("only the director can change settings; mats add and remove table links", async () => {
    const { slug, directorToken, weighInToken } = await createEvent();
    const denied = await app.inject({ method: "PATCH", url: `/api/events/${slug}`, headers: auth(weighInToken), payload: { name: "x y" } });
    expect(denied.statusCode).toBe(403);
    const ok = await app.inject({
      method: "PATCH",
      url: `/api/events/${slug}`,
      headers: auth(directorToken),
      payload: { settings: { mats: 3, registrationOpen: true } },
    });
    expect(ok.statusCode).toBe(200);
    const info = (await app.inject({ url: `/api/events/${slug}`, headers: auth(directorToken) })).json();
    expect(info.settings.mats).toBe(3);
    expect(info.settings.grouping.targetSize).toBe(4);
    expect(info.staffLinks.filter((l: { role: string }) => l.role === "table")).toHaveLength(3);
  });

  it("resets a staff link so the old one stops working", async () => {
    const { slug, directorToken, weighInToken, info } = await createEvent();
    const link = info.staffLinks.find((l: { role: string }) => l.role === "weigh-in");
    const res = await app.inject({ method: "POST", url: `/api/events/${slug}/links/${link.id}/reset`, headers: auth(directorToken) });
    const { token } = res.json();
    expect((await app.inject({ url: `/api/events/${slug}/entries`, headers: auth(weighInToken) })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/events/${slug}/entries`, headers: auth(token) })).statusCode).toBe(200);
  });

  it("404s unknown events", async () => {
    expect((await app.inject({ url: "/api/events/nope42" })).statusCode).toBe(404);
  });
});
