import { and, eq, lt, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { events } from "../db/schema.js";
import { HttpError } from "../errors.js";
import { RateLimiter } from "../rateLimit.js";
import { buildDemo } from "../services/demo.js";

/** Most demo tournaments alive at once, across all visitors. */
const MAX_LIVE_DEMOS = 300;
export const DEMO_LIFETIME_HOURS = 24;

/** Delete demo tournaments older than a day. */
export async function cleanUpDemos(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - DEMO_LIFETIME_HOURS * 3600_000);
  const deleted = await db.delete(events).where(and(eq(events.isDemo, true), lt(events.createdAt, cutoff))).returning({ id: events.id });
  return deleted.length;
}

export function demoRoutes(app: FastifyInstance, db: Db): void {
  const limiter = new RateLimiter(10, 60 * 60 * 1000);

  /** A fresh, private demo tournament for this visitor, mid-event. They get the director link. */
  app.post("/api/demo", async (req, reply) => {
    const { kind } = z.object({ kind: z.enum(["youth", "high-school"]) }).parse(req.body ?? {});
    if (!limiter.allow(req.ip)) throw new HttpError(429, "You've made a lot of demos this hour. Please use one you already have, or try again later.");
    const [{ count }] = (await db.select({ count: sql<number>`count(*)::int` }).from(events).where(eq(events.isDemo, true))) as [{ count: number }];
    if (count >= MAX_LIVE_DEMOS) {
      await cleanUpDemos(db);
      throw new HttpError(503, "The demo is busy right now. Please try again in a few minutes.");
    }
    const demo = await buildDemo(app, db, kind);
    await db.update(events).set({ isDemo: true, listed: false }).where(eq(events.slug, demo.slug));
    return reply.status(201).send(demo);
  });
}
