import Fastify, { type FastifyServerOptions } from "fastify";
import type { Db } from "./db/client.js";
import { registerErrorHandler } from "./errors.js";
import { type Mailer, createMailer } from "./mailer.js";
import { boutRoutes } from "./routes/bouts.js";
import { bracketRoutes } from "./routes/brackets.js";
import { entryRoutes } from "./routes/entries.js";
import { eventRoutes } from "./routes/events.js";
import { groupingRoutes } from "./routes/grouping.js";

export function buildApp(db: Db, options: FastifyServerOptions & { mailer?: Mailer } = {}) {
  const { mailer, ...fastifyOptions } = options;
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024, trustProxy: process.env.TRUST_PROXY === "1", ...fastifyOptions });
  registerErrorHandler(app);
  app.get("/api/health", async () => ({ ok: true }));
  eventRoutes(app, db, mailer ?? createMailer((msg) => app.log.info(msg)));
  entryRoutes(app, db);
  groupingRoutes(app, db);
  bracketRoutes(app, db);
  boutRoutes(app, db);
  return app;
}
