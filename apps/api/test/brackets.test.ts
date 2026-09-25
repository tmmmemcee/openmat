import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { bouts, events } from "../src/db/schema.js";
import { eq, sql } from "drizzle-orm";
import { app, auth, createEvent } from "./helpers.js";

const { db } = createDb();

const hsEvent = {
  name: "County Invite",
  startDate: "2027-01-09",
  format: "weight-classes",
  rulesetId: "nfhs-2025-26",
  settings: { mats: 2 },
  divisions: [{ name: "HS Boys", gender: "boys", weightClasses: [106, 113], periodsSec: [120, 120, 120] }],
};

async function hsSetup(n106: number, n113 = 0) {
  const ev = await createEvent(hsEvent);
  const h = auth(ev.directorToken);
  const ids: Record<string, string[]> = { "106": [], "113": [] };
  for (const [cls, n] of [["106", n106], ["113", n113]] as const) {
    for (let i = 0; i < n; i++) {
      const e = (await app.inject({
        method: "POST",
        url: `/api/events/${ev.slug}/entries`,
        headers: h,
        payload: { firstName: `W${cls}_${i}`, lastName: "X", team: `Team${i % 4}`, weightClass: cls },
      })).json();
      await app.inject({ method: "PATCH", url: `/api/events/${ev.slug}/entries/${e.id}`, headers: h, payload: { weight: Number(cls) - 1 } });
      ids[cls]!.push(e.id);
    }
  }
  const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
    app.inject({ method, url: `/api/events/${ev.slug}${url}`, headers: h, ...(payload ? { payload } : {}) });
  return { ...ev, h, ids, call };
}

describe("brackets", () => {
  it("makes one bracket per weight class: round robin when small, double elim when big", async () => {
    const s = await hsSetup(9, 3);
    const gen = (await s.call("POST", "/brackets/generate", {})).json();
    expect(gen.created).toBe(2);
    const { brackets, wrestlers } = (await s.call("GET", "/brackets")).json();
    const [b106, b113] = brackets;
    expect(b106).toMatchObject({ name: "HS Boys · 106", format: "double-elim", size: 16 });
    expect(b113).toMatchObject({ name: "HS Boys · 113", format: "round-robin" });
    expect(b113.bouts).toHaveLength(3);
    expect(wrestlers).toHaveLength(12);
    // 9 in a 16 bracket: 7 byes in round one.
    expect(b106.bouts.filter((x: { key: string; status: string }) => x.key.startsWith("W1") && x.status === "bye")).toHaveLength(7);
  });

  it("puts seeds on their lines so 1 and 2 can only meet in the final, and redraws with new seeds", async () => {
    const s = await hsSetup(8);
    const [a, b, c] = s.ids["106"]!;
    await s.call("PATCH", `/entries/${a}`, { seed: 1 });
    await s.call("PATCH", `/entries/${b}`, { seed: 2 });
    await s.call("POST", "/brackets/generate", {});
    let bracket = (await s.call("GET", "/brackets")).json().brackets[0];
    expect(bracket.draw.slice(0, 2)).toEqual([a, b]);

    await s.call("PATCH", `/entries/${c}`, { seed: 1 });
    await s.call("PATCH", `/entries/${a}`, { seed: 3 });
    expect((await s.call("POST", `/brackets/${bracket.id}/redraw`)).statusCode).toBe(200);
    bracket = (await s.call("GET", "/brackets")).json().brackets[0];
    expect(bracket.draw.slice(0, 3)).toEqual([c, b, a]);
  });

  it("schedules every real bout on a mat with unique numbers, respecting rest", async () => {
    const s = await hsSetup(9, 4);
    await s.call("POST", "/brackets/generate", {});
    const res = (await s.call("POST", "/brackets/schedule", {})).json();
    expect(res.unscheduled).toBe(0);
    const { brackets } = (await s.call("GET", "/brackets")).json();
    const all = brackets.flatMap((b: { bouts: unknown[] }) => b.bouts) as {
      id: string;
      status: string;
      mat: number | null;
      boutNumber: string | null;
      plannedStartMin: number;
      durationMin: number;
      after: { boutId: string; restMin: number }[];
    }[];
    const real = all.filter((x) => x.status !== "bye");
    expect(real.every((x) => x.mat && x.boutNumber)).toBe(true);
    expect(all.filter((x) => x.status === "bye").every((x) => x.mat === null)).toBe(true);
    expect(new Set(real.map((x) => x.boutNumber)).size).toBe(real.length);
    const byId = new Map(all.map((x) => [x.id, x]));
    for (const x of real) {
      for (const a of x.after) {
        const prev = byId.get(a.boutId)!;
        expect(x.plannedStartMin).toBeGreaterThanOrEqual(prev.plannedStartMin + prev.durationMin + a.restMin - 1);
      }
    }
    expect(res.estimatedMinutes).toBeGreaterThan(0);
  });

  it("shows where unknown wrestlers come from, by bout number", async () => {
    const s = await hsSetup(4);
    await s.call("POST", "/brackets/generate", { format: "double-elim" });
    await s.call("POST", "/brackets/schedule", {});
    const b = (await s.call("GET", "/brackets")).json().brackets[0];
    const final = b.bouts.find((x: { key: string }) => x.key === "W2-1");
    const semi = b.bouts.find((x: { key: string }) => x.key === "W1-1");
    expect(final.aFrom).toBe(`Winner of bout ${semi.boutNumber}`);
  });

  it("works out who advances as results come in, and locks rebuilding", async () => {
    const s = await hsSetup(4);
    await s.call("POST", "/brackets/generate", { format: "double-elim" });
    let b = (await s.call("GET", "/brackets")).json().brackets[0];
    const semi = b.bouts.find((x: { key: string }) => x.key === "W1-1");
    await db.update(bouts).set({ winnerEntryId: semi.a, startedAt: new Date(), endedAt: new Date() }).where(eq(bouts.id, semi.id));
    // A direct database write, so tell the cache (the API does this itself).
    await db.update(events).set({ version: sql`${events.version} + 1` }).where(eq(events.slug, s.slug));
    b = (await s.call("GET", "/brackets")).json().brackets[0];
    expect(b.bouts.find((x: { key: string }) => x.key === "W2-1").a).toBe(semi.a);
    expect(b.bouts.find((x: { key: string }) => x.key === "W1-1").status).toBe("done");
    expect((await s.call("POST", "/brackets/generate", {})).statusCode).toBe(409);
    expect((await s.call("POST", `/brackets/${b.id}/redraw`)).statusCode).toBe(409);
  });

  it("youth events: one bracket per group, alone kids skipped with a reason", async () => {
    const ev = await createEvent();
    const h = auth(ev.directorToken);
    for (const [i, w] of [60, 61, 62, 63, 90].entries()) {
      const e = (await app.inject({
        method: "POST",
        url: `/api/events/${ev.slug}/entries`,
        headers: h,
        payload: { firstName: `K${i}`, lastName: "Y", birthYear: 2018, gender: "boys" },
      })).json();
      await app.inject({ method: "PATCH", url: `/api/events/${ev.slug}/entries/${e.id}`, headers: h, payload: { weight: w } });
    }
    await app.inject({ method: "POST", url: `/api/events/${ev.slug}/groups/auto`, headers: h });
    const gen = (await app.inject({ method: "POST", url: `/api/events/${ev.slug}/brackets/generate`, headers: h, payload: {} })).json();
    const { brackets } = (await app.inject({ url: `/api/events/${ev.slug}/brackets` })).json();
    expect(gen.created).toBe(brackets.length);
    expect(brackets.every((b: { format: string }) => b.format === "round-robin")).toBe(true);
    expect(brackets[0].name).toBe("10U Boys · Group 1");
  });
});

describe("bracket labels", () => {
  it("names the real source when a feeder bout is a bye", async () => {
    const s = await hsSetup(7);
    await s.call("POST", "/brackets/generate", { format: "double-elim" });
    await s.call("POST", "/brackets/schedule", {});
    const b = (await s.call("GET", "/brackets")).json().brackets[0];
    const labels = b.bouts.flatMap((x: { aFrom?: string; bFrom?: string }) => [x.aFrom, x.bFrom]).filter(Boolean) as string[];
    // Every source names a numbered bout, never an internal key like "L1-1".
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).toMatch(/of bout \d+$/);
  });
});

describe("team scores", () => {
  it("adds up points by team as results come in", async () => {
    const s = await hsSetup(4);
    await s.call("POST", "/brackets/generate", { format: "double-elim", places: 4 });
    await s.call("POST", "/brackets/schedule", {});
    const finish = async (key: string, winType: string, extra: object = {}) => {
      const bout = (await s.call("GET", "/brackets")).json().brackets[0].bouts.find((x: { key: string }) => x.key === key);
      await s.call("POST", `/bouts/${bout.id}/finish`, { mode: "manual", winner: "A", winType, ...extra });
      return bout;
    };
    await finish("W1-1", "FALL");
    expect((await s.call("GET", "/team-scores")).json()[0]).toMatchObject({ points: 4, advancement: 2, bonus: 2 });
    await finish("W1-2", "DEC", { score: { A: 3, B: 1 } });
    await finish("W2-1", "DEC", { score: { A: 3, B: 1 } });
    await finish("L1-1", "DEC", { score: { A: 3, B: 1 } });
    const scores = (await s.call("GET", "/team-scores")).json();
    const total = scores.reduce((sum: number, t: { points: number }) => sum + t.points, 0);
    // Advancement 2+2, fall bonus 2, places 16+12+9+7.
    expect(total).toBe(50);
  });
});
