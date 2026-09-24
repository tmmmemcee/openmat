import Fastify, { type FastifyServerOptions } from "fastify";
import type { Db } from "./db/client.js";
import { registerErrorHandler } from "./errors.js";
import { entryRoutes } from "./routes/entries.js";
import { eventRoutes } from "./routes/events.js";
import { groupingRoutes } from "./routes/grouping.js";

export function buildApp(db: Db, options: FastifyServerOptions = {}) {
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024, ...options });
  registerErrorHandler(app);
  app.get("/api/health", async () => ({ ok: true }));
  eventRoutes(app, db);
  entryRoutes(app, db);
  groupingRoutes(app, db);
  return app;
}
