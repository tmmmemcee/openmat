import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";

const { db } = createDb();
const app = buildApp(db, { logger: { level: process.env.LOG_LEVEL ?? "info" } });
const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });
