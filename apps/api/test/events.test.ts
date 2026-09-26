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

  it("exposes the event's timezone so clones can preserve it", async () => {
    const { slug, directorToken } = await createEvent();
    const info = (await app.inject({ url: `/api/events/${slug}`, headers: auth(directorToken) })).json();
    expect(typeof info.timezone).toBe("string");
    expect(info.timezone.length).toBeGreaterThan(0);
    const pub = (await app.inject({ url: `/api/events/${slug}` })).json();
    expect(pub.timezone).toBe(info.timezone);
  });

  it("cloning an event copies structure, not per-event data", async () => {
    const { slug: srcSlug, directorToken } = await createEvent({
      ...youthEvent,
      name: "Source Tournament",
      location: "Source Gym",
      city: "Springfield",
      state: "IL",
      timezone: "America/Chicago",
      settings: { mats: 3 },
      divisions: ["8U", "10U"].flatMap((age, i) =>
        (["boys", "girls"] as const).map((gender) => ({
          name: `${age} ${gender === "boys" ? "Boys" : "Girls"}`,
          ageDivision: age,
          maxAge: 8 + i * 2,
          gender,
          periodsSec: [60, 60, 60],
        })),
      ),
    });
    const src = (await app.inject({ url: `/api/events/${srcSlug}`, headers: auth(directorToken) })).json();

    // Clone: same structure, fresh per-event fields, posted with the source's timezone.
    const cloneRes = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: {
        name: `${src.name} (copy)`,
        startDate: src.startDate,
        startTime: src.startTime,
        timezone: src.timezone,
        location: src.location,
        city: src.city,
        state: src.state,
        listed: false,
        directorEmail: null,
        format: src.format,
        rulesetId: src.ruleset.id,
        settings: { mats: src.settings.mats, restMin: src.settings.restMin },
        divisions: src.divisions.map((d: { name: string; ageDivision: string | null; maxAge: number | null; gender: string; weightClasses: number[] | null; maxClassesUp: number; periodsSec: number[] }) => ({
          name: d.name,
          ageDivision: d.ageDivision,
          maxAge: d.maxAge,
          gender: d.gender,
          weightClasses: d.weightClasses,
          maxClassesUp: d.maxClassesUp,
          periodsSec: d.periodsSec,
        })),
      },
    });
    expect(cloneRes.statusCode).toBe(201);
    const { slug: newSlug, directorToken: newDirector } = cloneRes.json();
    expect(newSlug).not.toBe(srcSlug);
    expect(newDirector).not.toBe(directorToken);

    const cloned = (await app.inject({ url: `/api/events/${newSlug}`, headers: auth(newDirector) })).json();

    // Structure round-trips.
    expect(cloned.format).toBe(src.format);
    expect(cloned.ruleset.id).toBe(src.ruleset.id);
    expect(cloned.seasonYear).toBe(src.seasonYear);
    expect(cloned.timezone).toBe(src.timezone);
    expect(cloned.settings.mats).toBe(src.settings.mats);
    expect(cloned.settings.restMin).toBe(src.settings.restMin);
    expect(cloned.divisions).toHaveLength(src.divisions.length);
    expect(cloned.divisions.map((d: { name: string }) => d.name).sort()).toEqual(src.divisions.map((d: { name: string }) => d.name).sort());
    for (const d of cloned.divisions) {
      const original = src.divisions.find((o: { name: string }) => o.name === d.name);
      expect(d.ageDivision).toBe(original.ageDivision);
      expect(d.maxAge).toBe(original.maxAge);
      expect(d.gender).toBe(original.gender);
      expect(d.periodsSec).toEqual(original.periodsSec);
    }

    // Per-event data is fresh and empty.
    expect(cloned.listed).toBe(false);
    expect(cloned.settings.registrationOpen).toBe(false);
    expect(cloned.isDemo).toBe(false);

    // Fresh access links: weigh-in + one per mat, plus the new director token.
    const linkRoles = cloned.staffLinks.map((l: { role: string; mat: number | null }) => `${l.role}${l.mat ?? ""}`).sort();
    expect(linkRoles).toEqual(["table1", "table2", "table3", "weigh-in"]);
    const linkTokens = cloned.staffLinks.map((l: { token: string }) => l.token);
    expect(new Set(linkTokens).size).toBe(linkTokens.length);

    // Empty per-event tables.
    expect((await app.inject({ url: `/api/events/${newSlug}/entries`, headers: auth(newDirector) })).json()).toEqual([]);
    expect((await app.inject({ url: `/api/events/${newSlug}/brackets`, headers: auth(newDirector) })).json()).toEqual({ brackets: [], wrestlers: [] });
    const groups = (await app.inject({ url: `/api/events/${newSlug}/groups`, headers: auth(newDirector) })).json();
    expect(groups).toEqual({ groups: [], ungroupedIds: [] });

    // Old director token doesn't grant director access on the clone.
    const oldOnClone = (await app.inject({ url: `/api/events/${newSlug}`, headers: auth(directorToken) })).json();
    expect(oldOnClone.access).toBeNull();
    expect(oldOnClone.staffLinks).toBeUndefined();
  });
});
