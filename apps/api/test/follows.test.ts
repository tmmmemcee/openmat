import { describe, expect, it } from "vitest";
import { app, auth, createEvent, notifier } from "./helpers.js";

const hsEvent = {
  name: "Alert Open",
  startDate: "2027-01-09",
  timezone: "America/Chicago",
  format: "weight-classes",
  rulesetId: "nfhs-2025-26",
  settings: { mats: 1 },
  divisions: [{ name: "HS", gender: "boys", weightClasses: [106], periodsSec: [120, 120, 120] }],
};

async function setup() {
  const ev = await createEvent(hsEvent);
  const h = auth(ev.directorToken);
  const ids: string[] = [];
  for (const [i, team] of ["Hawks", "Hawks", "Owls", "Owls"].entries()) {
    const e = (await app.inject({ method: "POST", url: `/api/events/${ev.slug}/entries`, headers: h, payload: { firstName: `Kid${i}`, lastName: "Q", team, weightClass: "106" } })).json();
    await app.inject({ method: "PATCH", url: `/api/events/${ev.slug}/entries/${e.id}`, headers: h, payload: { weight: 105 } });
    ids.push(e.id);
  }
  const table = ev.info.staffLinks.find((l: { role: string }) => l.role === "table").token as string;
  const post = (url: string, payload?: object, headers: object = h) =>
    app.inject({ method: "POST", url: `/api/events/${ev.slug}${url}`, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const follow = async (payload: object) => (await post("/follows", { channel: "email", email: "mom@example.com", ...payload }, {})).json();
  const alerts = async () => {
    await app.notifications.settle();
    return notifier.sent.map((s) => s.alert.title);
  };
  return { ...ev, h, ids, table, post, follow, alerts };
}

describe("follows and alerts", () => {
  it("alerts the first match, in the hole, on deck, and results, once each", async () => {
    const s = await setup();
    await s.post("/brackets/generate", { format: "double-elim" });
    await s.follow({ entryId: s.ids[0] });
    expect(await s.alerts()).toEqual([]); // nothing scheduled yet

    await s.post("/brackets/schedule", {});
    const afterSchedule = await s.alerts();
    expect(afterSchedule.some((t) => t.startsWith("Kid0 Q: first match on Mat 1"))).toBe(true);

    // Wrestle bouts on the only mat until Kid0 is done with one.
    const queue = async () => (await app.inject({ url: `/api/events/${s.slug}/mats/1` })).json().queue as { bout: { id: string; a: string; b: string; status: string } }[];
    for (let i = 0; i < 3; i++) {
      const next = (await queue()).find((q) => q.bout.status === "ready")!;
      await s.post(`/bouts/${next.bout.id}/finish`, { mode: "manual", winner: "A", winType: "DEC", score: { A: 3, B: 1 } }, auth(s.table));
      await s.alerts(); // real bouts take minutes; let alerts go out between them
    }
    const titles = await s.alerts();
    expect(titles.filter((t) => t.includes("on deck")).length).toBeGreaterThanOrEqual(1);
    expect(titles.some((t) => t === "Kid0 Q won" || t === "Kid0 Q lost")).toBe(true);
    // Nothing repeats (the same title can come back for a later bout; the body names the bout).
    const messages = notifier.sent.map((m) => `${m.alert.title} | ${m.alert.body}`);
    expect(new Set(messages).size).toBe(messages.length);
    const count = titles.length;
    await s.post("/brackets/schedule", {}).catch(() => null);
    expect((await s.alerts()).length).toBe(count);
  });

  it("team follows cover every wrestler on the team", async () => {
    const s = await setup();
    await s.post("/brackets/generate", { format: "double-elim" });
    await s.follow({ team: "owls" });
    await s.post("/brackets/schedule", {});
    const firsts = (await s.alerts()).filter((t) => t.includes("first match"));
    expect(firsts.sort()).toEqual(["Kid2 Q: first match on Mat 1", "Kid3 Q: first match on Mat 1"]);
  });

  it("doesn't send results from before someone followed", async () => {
    const s = await setup();
    await s.post("/brackets/generate", { format: "double-elim" });
    await s.post("/brackets/schedule", {});
    const first = (await app.inject({ url: `/api/events/${s.slug}/mats/1` })).json().queue[0].bout;
    await s.post(`/bouts/${first.id}/finish`, { mode: "manual", winner: "A", winType: "FALL" }, auth(s.table));
    await s.follow({ entryId: first.a });
    expect((await s.alerts()).some((t) => t.includes("won"))).toBe(false);
  });

  it("unfollows only with the device's secret", async () => {
    const s = await setup();
    const f = await s.follow({ entryId: s.ids[1] });
    const del = (secret: string) => app.inject({ method: "DELETE", url: `/api/follows/${f.id}`, payload: { secret } });
    await del("wrong");
    await s.post("/brackets/generate", { format: "double-elim" });
    await s.post("/brackets/schedule", {});
    expect((await s.alerts()).length).toBeGreaterThan(0);
    notifier.sent.length = 0;
    await del(f.secret);
    const next = (await app.inject({ url: `/api/events/${s.slug}/mats/1` })).json().queue[0].bout;
    await s.post(`/bouts/${next.id}/finish`, { mode: "manual", winner: "A", winType: "FALL" }, auth(s.table));
    expect(await s.alerts()).toEqual([]);
  });

  it("rejects bad follows", async () => {
    const s = await setup();
    expect((await s.post("/follows", { channel: "push", entryId: s.ids[0] }, {})).statusCode).toBe(400);
    expect((await s.post("/follows", { channel: "email", email: "a@b.co", entryId: s.ids[0], team: "Owls" }, {})).statusCode).toBe(400);
  });

  it("reports where a wrestler stands", async () => {
    const s = await setup();
    await s.post("/brackets/generate", { format: "double-elim" });
    await s.post("/brackets/schedule", {});
    const status = (await app.inject({ url: `/api/events/${s.slug}/wrestler-status?ids=${s.ids[0]}` })).json();
    expect(status[0]).toMatchObject({ name: "Kid0 Q", team: "Hawks", bracket: { name: "HS · 106" }, next: { mat: 1 } });
    expect(status[0].next.boutNumber).toMatch(/^1\d\d$/);
    const roster = (await app.inject({ url: `/api/events/${s.slug}/roster` })).json();
    expect(roster).toHaveLength(4);
    expect(roster[0]).toEqual({ id: expect.any(String), firstName: expect.any(String), lastName: "Q", team: expect.any(String), division: "HS" });
  });
});

describe("alert timing", () => {
  it("keeps alerts flowing during constant activity", async () => {
    const { NotificationScheduler } = await import("../src/services/notify.js");
    let runs = 0;
    const scheduler = new NotificationScheduler({} as never, {} as never, "", 50);
    (scheduler as unknown as { runNow: () => Promise<void> }).runNow = async () => {
      runs++;
    };
    // A change every 20ms for 300ms: a debounce would never fire; this runs several times.
    for (let i = 0; i < 15; i++) {
      scheduler.poke("e1");
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 80));
    expect(runs).toBeGreaterThanOrEqual(4);
  });
});
