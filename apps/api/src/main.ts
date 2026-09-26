/**
 * Server entry. Environment:
 *   PORT, HOST            where to listen (default 127.0.0.1:3001)
 *   WEB_CONCURRENCY       worker processes (e.g. one per CPU core); default 1
 *   STATIC_DIR            serve the built web app from here (single-box hosting)
 *   LOG_LEVEL, NODE_ENV   production turns off per-request logging
 */
import cluster from "node:cluster";
import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";
import { cleanUpDemos } from "./routes/demo.js";
import { serveUploads, serveWebApp } from "./static.js";

const workers = Math.max(1, Number(process.env.WEB_CONCURRENCY ?? 1));

/** Delete day-old demo tournaments now and every hour (in one process only). */
function sweepDemos(log: (err: unknown) => void) {
  const { db } = createDb(process.env.DATABASE_URL);
  const sweep = () => cleanUpDemos(db).catch(log);
  void sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();
}

if (cluster.isPrimary && workers > 1) {
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on("exit", (worker, code) => {
    console.error(`worker ${worker.process.pid} exited (${code}); starting a new one`);
    cluster.fork();
  });
  sweepDemos((err) => console.error("demo cleanup failed", err));
} else {
  const { db } = createDb();
  const app = await buildApp(db, { logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await serveUploads(app, process.env.UPLOADS_DIR ?? resolve(process.cwd(), "apps/api/uploads"));
  if (process.env.STATIC_DIR) await serveWebApp(app, process.env.STATIC_DIR);
  await app.listen({ port: Number(process.env.PORT ?? 3001), host: process.env.HOST ?? "127.0.0.1" });
  if (workers === 1) sweepDemos((err) => app.log.error(err, "demo cleanup failed"));
}
