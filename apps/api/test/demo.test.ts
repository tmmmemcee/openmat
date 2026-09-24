import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { events } from "../src/db/schema.js";
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

  it("youth demos too, and day-old demos get cleaned up", { timeout: 60_000 }, async () => {
    const { slug } = (await app.inject({ method: "POST", url: "/api/demo", payload: { kind: "youth" } })).json();
    expect(await cleanUpDemos(db)).toBe(0);
    await db.update(events).set({ createdAt: sql`now() - interval '25 hours'` }).where(eq(events.slug, slug));
    expect(await cleanUpDemos(db)).toBe(1);
    expect((await app.inject({ url: `/api/events/${slug}` })).statusCode).toBe(404);
  });

  it("rejects unknown demo kinds", async () => {
    expect((await app.inject({ method: "POST", url: "/api/demo", payload: { kind: "sumo" } })).statusCode).toBe(400);
  });
});
