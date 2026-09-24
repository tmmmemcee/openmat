import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./db/client.js";

const { db, sql } = createDb();
await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
await sql.end();
console.log("Database is up to date.");
