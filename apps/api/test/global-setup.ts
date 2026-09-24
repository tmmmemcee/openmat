import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../src/db/client.js";

export async function setup() {
  const { db, sql } = createDb(process.env.TEST_DATABASE_URL ?? "postgres://openmat:openmat@localhost:5433/openmat_test");
  await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  await sql.end();
}
