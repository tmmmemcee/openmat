import { describe, expect, it } from "vitest";
import { app, auth, createEvent } from "./helpers.js";

const hsEvent = {
  name: "Dual Invite",
  startDate: "2027-01-09",
  format: "weight-classes",
  rulesetId: "nfhs-2025-26",
  settings: { mats: 2 },
  divisions: [{ name: "HS", gender: "boys", weightClasses: [106], periodsSec: [120, 120, 120] }],
};

async function setup(n = 4) {
  const ev = await createEvent(hsEvent);
  const h = auth(ev.directorToken);
  for (let i = 0; i < n; i++) {
    const e = (await app.inject({ method: "POST", url: `/api/events/${ev.slug}/entries`, headers: h, payload: { firstName: `W${i}`, lastName: "Z", team: `T${i}`, weightClass: "106" } })).json();
    await app.inject({ method: "PATCH", url: `/api/events/${ev.slug}/entries/${e.id}`, headers: h, payload: { weight: 105 } });
  }
  await app.inject({ method: "POST", url: `/api/events/${ev.slug}/brackets/generate`, headers: h, payload: { format: "double-elim" } });
  await app.inject({ method: "POST", url: `/api/events/${ev.slug}/brackets/schedule`, headers: h, payload: { keepGroupsTogether: false } });
  const tables = ev.info.staffLinks.filter((l: { role: string }) => l.role === "table");
  const tableAuth = (mat: number) => auth(tables.find((t: { mat: number }) => t.mat === mat).token);
  const bracket = async () => (await app.inject({ url: `/api/events/${ev.slug}/brackets` })).json().brackets[0];
  const bout = async (key: string) => (await bracket()).bouts.find((b: { key: string }) => b.key === key);
  const post = (url: string, headers: object, payload?: object) =>
    app.inject({ method: "POST", url: `/api/events/${ev.slug}${url}`, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  return { ...ev, h, tableAuth, bracket, bout, post };
}

let n = 0;
const ev = (e: object) => ({ id: `evt-${Date.now()}-${++n}`, ...e });

describe("table scoring", () => {
  it("scores a bout live and advances the winner", async () => {
    const s = await setup();
    const semi = await s.bout("W1-1");
    const t = s.tableAuth(semi.mat);
    expect((await s.post(`/bouts/${semi.id}/start`, t)).statusCode).toBe(200);
    const events = [ev({ type: "score", corner: "A", action: "T3", period: 1, matchTimeSec: 30 }), ev({ type: "score", corner: "B", action: "E1", period: 2, matchTimeSec: 150 })];
    const res = (await s.post(`/bouts/${semi.id}/events`, t, { events })).json();
    expect(res.state.score).toEqual({ A: 3, B: 1 });
    // Retrying the same events doesn't double count.
    expect((await s.post(`/bouts/${semi.id}/events`, t, { events })).json().state.score).toEqual({ A: 3, B: 1 });
    const fin = (await s.post(`/bouts/${semi.id}/finish`, t, { mode: "live", ending: { type: "time" } })).json();
    expect(fin.result.summary).toBe("Dec 3-1");
    expect(fin.winnerEntryId).toBe(semi.a);
    expect((await s.bout("W2-1")).a).toBe(semi.a);
    expect((await s.bout("L1-1")).a).toBe(semi.b);
  });

  it("takes a result-only entry and rejects one that doesn't add up", async () => {
    const s = await setup();
    const semi = await s.bout("W1-2");
    const t = s.tableAuth(semi.mat);
    expect((await s.post(`/bouts/${semi.id}/finish`, t, { mode: "manual", winner: "B", winType: "DEC", score: { A: 2, B: 12 } })).json().error).toContain("major");
    const ok = (await s.post(`/bouts/${semi.id}/finish`, t, { mode: "manual", winner: "B", winType: "FALL", matchTimeSec: 75 })).json();
    expect(ok.result.summary).toBe("F 1:15");
    expect((await s.bout("W1-2")).status).toBe("done");
  });

  it("keeps each table on its own mat", async () => {
    const s = await setup();
    const semi = await s.bout("W1-1");
    const otherMat = semi.mat === 1 ? 2 : 1;
    const res = await s.post(`/bouts/${semi.id}/start`, s.tableAuth(otherMat));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain(`mat ${semi.mat}`);
  });

  it("tables can fix a result until a later bout starts; then only the director, who sees conflicts", async () => {
    const s = await setup();
    const w1 = await s.bout("W1-1");
    const w2 = await s.bout("W1-2");
    await s.post(`/bouts/${w1.id}/finish`, s.tableAuth(w1.mat), { mode: "manual", winner: "A", winType: "DEC", score: { A: 3, B: 1 } });
    // Fix it right away: fine.
    expect((await s.post(`/bouts/${w1.id}/finish`, s.tableAuth(w1.mat), { mode: "manual", winner: "A", winType: "DEC", score: { A: 4, B: 1 } })).statusCode).toBe(200);
    await s.post(`/bouts/${w2.id}/finish`, s.tableAuth(w2.mat), { mode: "manual", winner: "A", winType: "DEC", score: { A: 3, B: 1 } });
    const final = await s.bout("W2-1");
    await s.post(`/bouts/${final.id}/start`, s.tableAuth(final.mat));
    await s.post(`/bouts/${final.id}/finish`, s.tableAuth(final.mat), { mode: "manual", winner: "A", winType: "DEC", score: { A: 3, B: 1 } });
    // Now the semi can't be changed by the table...
    const blocked = await s.post(`/bouts/${w1.id}/finish`, s.tableAuth(w1.mat), { mode: "manual", winner: "B", winType: "DEC", score: { A: 1, B: 3 } });
    expect(blocked.statusCode).toBe(403);
    // ...but the director can, and learns the final is now wrong.
    const fixed = (await s.post(`/bouts/${w1.id}/finish`, s.h, { mode: "manual", winner: "B", winType: "DEC", score: { A: 1, B: 3 } })).json();
    expect(fixed.conflicts.map((c: { id: string }) => c.id)).toContain(final.id);
    // Director resets the final; it goes back in the queue with the right wrestler.
    await s.post(`/bouts/${final.id}/reset`, s.h);
    const again = await s.bout("W2-1");
    expect(again.status).toBe("ready");
    expect(again.a).toBe(w1.b);
  });

  it("shows the mat queue with now / on deck / in the hole and times", async () => {
    const s = await setup(8);
    const first = (await app.inject({ url: `/api/events/${s.slug}/mats/1` })).json();
    expect(first.queue[0].position).toBe("on-deck");
    expect(first.queue[1].position).toBe("in-the-hole");
    expect(first.queue[0].estimatedStart).toBeTruthy();
    const b = first.queue[0].bout;
    await s.post(`/bouts/${b.id}/start`, s.tableAuth(1));
    const next = (await app.inject({ url: `/api/events/${s.slug}/mats/1` })).json();
    expect(next.queue[0]).toMatchObject({ position: "wrestling", bout: { id: b.id } });
    expect(next.queue[1].position).toBe("on-deck");
    expect(next.wrestlers.length).toBeGreaterThan(0);
  });

  it("hides the scoring log's authors from the public but shows the score", async () => {
    const s = await setup();
    const semi = await s.bout("W1-1");
    await s.post(`/bouts/${semi.id}/events`, s.tableAuth(semi.mat), { events: [ev({ type: "score", corner: "A", action: "T3" })] });
    const pub = (await app.inject({ url: `/api/events/${s.slug}/bouts/${semi.id}` })).json();
    expect(pub.state.score.A).toBe(3);
    expect(pub.events).toBeUndefined();
    expect(pub.bout.status).toBe("wrestling");
  });
});

describe("director console", () => {
  it("moves a bout to another mat and place in line; tables can't", async () => {
    const s = await setup(8);
    const q = async (mat: number) => (await app.inject({ url: `/api/events/${s.slug}/mats/${mat}` })).json().queue as { bout: { id: string } }[];
    const mat2 = await q(2);
    const moving = mat2[mat2.length - 1]!.bout.id;
    const patch = (headers: object, payload: object) =>
      app.inject({ method: "PATCH", url: `/api/events/${s.slug}/bouts/${moving}`, headers: headers as Record<string, string>, payload });
    expect((await patch(s.tableAuth(2), { mat: 1, position: 1 })).statusCode).toBe(403);
    expect((await patch(s.h, { mat: 1, position: 1 })).statusCode).toBe(200);
    const mat1 = await q(1);
    expect(mat1[0]!.bout.id).toBe(moving);
    expect((await q(2)).some((x) => x.bout.id === moving)).toBe(false);
    // Move it to the end of the line.
    await patch(s.h, { mat: 1 });
    const again = await q(1);
    expect(again[again.length - 1]!.bout.id).toBe(moving);
  });

  it("won't move a bout that has started", async () => {
    const s = await setup(4);
    const semi = await s.bout("W1-1");
    await s.post(`/bouts/${semi.id}/start`, s.tableAuth(semi.mat));
    const res = await app.inject({ method: "PATCH", url: `/api/events/${s.slug}/bouts/${semi.id}`, headers: s.h, payload: { mat: semi.mat === 1 ? 2 : 1 } });
    expect(res.statusCode).toBe(409);
  });
});

describe("position in the scoring log", () => {
  it("accepts period choices and reports the position", async () => {
    const s = await setup();
    const semi = await s.bout("W1-1");
    const t = s.tableAuth(semi.mat);
    const res = (await s.post(`/bouts/${semi.id}/events`, t, {
      events: [
        ev({ type: "score", corner: "A", action: "T3", period: 1 }),
        ev({ type: "position", position: "B-top", chooser: "B", choice: "top", period: 2 }),
      ],
    })).json();
    expect(res.state.position).toBe("B-top");
    expect(res.state.positionPeriods).toEqual([2]);
  });
});

describe("live details for the mat board", () => {
  it("shows score, position and the table's clock for bouts in progress", async () => {
    const s = await setup();
    const semi = await s.bout("W1-1");
    const t = s.tableAuth(semi.mat);
    await s.post(`/bouts/${semi.id}/events`, t, { events: [ev({ type: "score", corner: "B", action: "T3", period: 1, matchTimeSec: 40 })] });
    await s.post(`/bouts/${semi.id}/clock`, t, { period: 1, remainingSec: 80, running: true });
    const q = (await app.inject({ url: `/api/events/${s.slug}/mats/${semi.mat}` })).json();
    const live = q.queue.find((x: { bout: { id: string } }) => x.bout.id === semi.id).live;
    expect(live).toMatchObject({ score: { A: 0, B: 3 }, position: "B-top", clock: { period: 1, remainingSec: 80, running: true } });
    expect(q.serverNow).toBeTruthy();
    // Other mats' tables can't set this bout's clock.
    const other = semi.mat === 1 ? 2 : 1;
    expect((await s.post(`/bouts/${semi.id}/clock`, s.tableAuth(other), { period: 1, remainingSec: 10, running: false })).statusCode).toBe(403);
  });
});
