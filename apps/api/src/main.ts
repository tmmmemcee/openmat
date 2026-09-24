import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";
import { cleanUpDemos } from "./routes/demo.js";

const { db } = createDb();
const app = buildApp(db, { logger: { level: process.env.LOG_LEVEL ?? "info" } });
const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });

// Delete day-old demo tournaments now and every hour.
const sweep = () => cleanUpDemos(db).catch((err) => app.log.error(err, "demo cleanup failed"));
void sweep();
setInterval(sweep, 60 * 60 * 1000).unref();
