import Fastify, { type FastifyServerOptions } from "fastify";
import multipart from "@fastify/multipart";
import { eq } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { events } from "./db/schema.js";
import { registerErrorHandler } from "./errors.js";
import { PUBLIC_BASE_URL } from "./config.js";
import { type Mailer, createMailer } from "./mailer.js";
import { demoRoutes } from "./routes/demo.js";
import { followRoutes } from "./routes/follows.js";
import { NotificationScheduler, type Notifier, createNotifier } from "./services/notify.js";
import { bumpVersion } from "./services/snapshot.js";
import { boutRoutes } from "./routes/bouts.js";
import { bracketRoutes } from "./routes/brackets.js";
import { entryRoutes } from "./routes/entries.js";
import { eventRoutes } from "./routes/events.js";
import { groupingRoutes } from "./routes/grouping.js";

export async function buildApp(db: Db, options: FastifyServerOptions & { mailer?: Mailer; notifier?: Notifier } = {}) {
  const { mailer: givenMailer, notifier: givenNotifier, ...fastifyOptions } = options;
  const app = Fastify({
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: process.env.TRUST_PROXY === "1",
    // Per-request log lines cost real time under load; keep errors only in production.
    disableRequestLogging: process.env.NODE_ENV === "production",
    ...fastifyOptions,
  });
  registerErrorHandler(app);
  // Photo uploads (and later event logos) come through @fastify/multipart.
  // 5MB per file; the JSON body limit stays 5MB for non-upload endpoints.
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
  // Every successful change to a tournament bumps its version so cached views
  // are rebuilt. Routes marked `config: { live: true }` (scoring taps, the match
  // clock) only bump the live version; `config: { readOnly: true }` bump nothing.
  app.addHook("onSend", async (req, reply, payload) => {
    const slug = (req.params as { slug?: string } | undefined)?.slug;
    const config = req.routeOptions.config as { live?: boolean; readOnly?: boolean };
    if (slug && req.method !== "GET" && req.method !== "HEAD" && reply.statusCode < 400 && !config.readOnly) {
      const [row] = await db.select({ id: events.id }).from(events).where(eq(events.slug, slug));
      if (row) await bumpVersion(db, row.id, config.live ? "live" : "structure");
    }
    return payload;
  });
  app.get("/api/health", async () => ({ ok: true }));
  const mailer = givenMailer ?? createMailer((msg) => app.log.info(msg));
  const notifier = givenNotifier ?? createNotifier(db, mailer);
  const scheduler = new NotificationScheduler(db, notifier, PUBLIC_BASE_URL);
  app.decorate("notifications", scheduler);
  eventRoutes(app, db, mailer);
  entryRoutes(app, db);
  groupingRoutes(app, db);
  bracketRoutes(app, db, scheduler);
  boutRoutes(app, db, scheduler);
  followRoutes(app, db, notifier, scheduler);
  demoRoutes(app, db);
  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    notifications: NotificationScheduler;
  }
  interface FastifyContextConfig {
    /** Only live details change (scoring taps, clock). */
    live?: boolean;
    /** A POST that doesn't change anything. */
    readOnly?: boolean;
  }
}
