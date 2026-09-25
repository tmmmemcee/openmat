import { describe, expect, it } from "vitest";
import { app, auth, createEvent } from "./helpers.js";

const hsEvent = {
  name: "Cache Classic",
  startDate: "2027-01-09",
  format: "weight-classes",
  rulesetId: "nfhs-2025-26",
  settings: { mats: 2 },
  divisions: [{ name: "HS", gender: "boys", weightClasses: [106], periodsSec: [120, 120, 120] }],
};

async function setup() {
  const ev = await createEvent(hsEvent);
  const h = auth(ev.directorToken);
  for (let i = 0; i < 8; i++) {
    const e = (await app.inject({ method: "POST", url: `/api/events/${ev.slug}/entries`, headers: h, payload: { firstName: `C${i}`, lastName: "Z", team: `T${i}`, weightClass: "106" } })).json();
    await app.inject({ method: "PATCH", url: `/api/events/${ev.slug}/entries/${e.id}`, headers: h, payload: { weight: 105 } });
  }
  await app.inject({ method: "POST", url: `/api/events/${ev.slug}/brackets/generate`, headers: h, payload: { format: "double-elim" } });
  await app.inject({ method: "POST", url: `/api/events/${ev.slug}/brackets/schedule`, headers: h, payload: {} });
  const table = (mat: number) => auth(ev.info.staffLinks.find((l: { role: string; mat: number }) => l.role === "table" && l.mat === mat).token);
  return { ...ev, h, table };
}

describe("caching", () => {
  it("public reads carry a version tag and answer 304 until something changes", async () => {
    const s = await setup();
    const first = await app.inject({ url: `/api/events/${s.slug}/brackets` });
    expect(first.headers["cache-control"]).toContain("public");
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();
    const again = await app.inject({ url: `/api/events/${s.slug}/brackets`, headers: { "if-none-match": etag } });
    expect(again.statusCode).toBe(304);

    const bout = first.json().brackets[0].bouts.find((b: { status: string; mat: number }) => b.status === "ready" && b.mat);
    await app.inject({ method: "POST", url: `/api/events/${s.slug}/bouts/${bout.id}/finish`, headers: s.table(bout.mat), payload: { mode: "manual", winner: "A", winType: "FALL" } });
    const after = await app.inject({ url: `/api/events/${s.slug}/brackets`, headers: { "if-none-match": etag } });
    expect(after.statusCode).toBe(200);
    expect(after.json().brackets[0].bouts.find((b: { id: string }) => b.id === bout.id).status).toBe("done");
  });

  it("never caches staff requests", async () => {
    const s = await setup();
    const res = await app.inject({ url: `/api/events/${s.slug}/mats`, headers: s.h });
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers.etag).toBeUndefined();
  });

  it("a scoring tap refreshes live scores without invalidating the brackets", async () => {
    const s = await setup();
    const mats = (await app.inject({ url: `/api/events/${s.slug}/mats` })).json();
    const bout = mats.mats[0].queue[0].bout;
    const t = s.table(1);
    const tap = (id: string) => ({ id, type: "score", corner: "A", action: "T3", period: 1 });
    // The first tap starts the bout, which changes the mat line (and the brackets).
    await app.inject({ method: "POST", url: `/api/events/${s.slug}/bouts/${bout.id}/events`, headers: t, payload: { events: [tap("tap-0001-aaaa")] } });
    const b1 = await app.inject({ url: `/api/events/${s.slug}/brackets` });
    const m1 = await app.inject({ url: `/api/events/${s.slug}/mats` });
    expect(m1.json().mats[0].queue[0]).toMatchObject({ position: "wrestling", live: { score: { A: 3, B: 0 } } });
    // Later taps only change the live details.
    await app.inject({
      method: "POST",
      url: `/api/events/${s.slug}/bouts/${bout.id}/events`,
      headers: t,
      payload: { events: [{ id: "tap-0002-bbbb", type: "score", corner: "A", action: "N2", period: 1 }] },
    });
    const b2 = await app.inject({ url: `/api/events/${s.slug}/brackets`, headers: { "if-none-match": b1.headers.etag as string } });
    expect(b2.statusCode).toBe(304);
    const m2 = await app.inject({ url: `/api/events/${s.slug}/mats`, headers: { "if-none-match": m1.headers.etag as string } });
    expect(m2.statusCode).toBe(200);
    expect(m2.json().mats[0].queue[0].live.score).toEqual({ A: 5, B: 0 });
  });
});
