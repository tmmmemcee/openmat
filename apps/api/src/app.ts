import Fastify, { type FastifyServerOptions } from "fastify";
import type { Db } from "./db/client.js";
import { registerErrorHandler } from "./errors.js";
import { PUBLIC_BASE_URL } from "./config.js";
import { type Mailer, createMailer } from "./mailer.js";
import { demoRoutes } from "./routes/demo.js";
import { followRoutes } from "./routes/follows.js";
import { NotificationScheduler, type Notifier, createNotifier } from "./services/notify.js";
import { boutRoutes } from "./routes/bouts.js";
import { bracketRoutes } from "./routes/brackets.js";
import { entryRoutes } from "./routes/entries.js";
import { eventRoutes } from "./routes/events.js";
import { groupingRoutes } from "./routes/grouping.js";

export function buildApp(db: Db, options: FastifyServerOptions & { mailer?: Mailer; notifier?: Notifier } = {}) {
  const { mailer: givenMailer, notifier: givenNotifier, ...fastifyOptions } = options;
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024, trustProxy: process.env.TRUST_PROXY === "1", ...fastifyOptions });
  registerErrorHandler(app);
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
}
