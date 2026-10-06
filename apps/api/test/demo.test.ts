import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { events, teams } from "../src/db/schema.js";
import { cleanUpDemos } from "../src/routes/demo.js";
import { app, auth } from "./helpers.js";

const { db } = createDb();

describe("live demo", () => {
  it("builds a private mid-event tournament the visitor directs", { timeout: 60_000 }, async () => {
    const res = await app.inject({ method: "POST", url: "/api/demo", payload: { kind: "high-school" } });
    expect(res.statusCode).toBe(201);
    const { slug, directorToken } = res.json();
    const info = (await app.inject({ url: `/api/events/${slug}`, headers: auth(directorToken) })).json();
    expect(info).toMatchObject({ isDemo: true, listed: false, access: { role: "director" } });
    const bouts = (await app.inject({ url: `/api/events/${slug}/brackets` })).json().brackets.flatMap((b: { bouts: { status: string }[] }) => b.bouts);
    expect(bouts.some((b: { status: string }) => b.status === "done")).toBe(true);
    expect(bouts.some((b: { status: string }) => b.status === "wrestling")).toBe(true);
    // Never in the public tournament list.
    const list = (await app.inject({ url: `/api/events?from=2000-01-01` })).json();
    expect(list.events.some((e: { slug: string }) => e.slug === slug)).toBe(false);
  });

  it("youth demos come from saved rosters with a coach link, and day-old demos (and their teams) get cleaned up", { timeout: 60_000 }, async () => {
    const { slug, directorToken, coach } = (await app.inject({ method: "POST", url: "/api/demo", payload: { kind: "youth" } })).json();
    const roster = await app.inject({ url: `/api/teams/${coach.teamId}`, headers: auth(coach.token) });
    expect(roster.statusCode).toBe(200);
    expect(roster.json().wrestlers.length).toBe(14);
    // The director sees experience; the public doesn't.
    const entries = (await app.inject({ url: `/api/events/${slug}/entries`, headers: auth(directorToken) })).json();
    expect(entries.filter((e: { skill?: object }) => e.skill).length).toBe(entries.length);

    expect(await cleanUpDemos(db)).toBe(0);
    await db.update(events).set({ createdAt: sql`now() - interval '25 hours'` }).where(eq(events.slug, slug));
    await db.update(teams).set({ createdAt: sql`now() - interval '25 hours'` }).where(eq(teams.isDemo, true));
    expect(await cleanUpDemos(db)).toBe(1);
    expect((await app.inject({ url: `/api/events/${slug}` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/teams/${coach.teamId}`, headers: auth(coach.token) })).statusCode).toBe(404);
  });

  it("builds a tri-meet that's paired, scheduled and part-wrestled", { timeout: 60_000 }, async () => {
    const { slug, directorToken } = (await app.inject({ method: "POST", url: "/api/demo", payload: { kind: "meet" } })).json();
    const board = (await app.inject({ url: `/api/events/${slug}/pairings`, headers: auth(directorToken) })).json();
    expect(board.wrestlers).toHaveLength(36);
    expect(board.pairings.length).toBeGreaterThan(25);
    const statuses = new Set(board.pairings.map((p: { status: string }) => p.status));
    expect(statuses).toEqual(new Set(["done", "wrestling", "ready"]));
    const scores = (await app.inject({ url: `/api/events/${slug}/team-scores` })).json();
    expect(scores.kind).toBe("meet");
    expect(scores.duals).toHaveLength(3);
  });

  it("rejects unknown demo kinds", async () => {
    expect((await app.inject({ method: "POST", url: "/api/demo", payload: { kind: "sumo" } })).statusCode).toBe(400);
  });
});
