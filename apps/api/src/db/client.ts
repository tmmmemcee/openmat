import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export const DEFAULT_DATABASE_URL = "postgres://openmat:openmat@localhost:5433/openmat";

export function createDb(url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL) {
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  return { db: drizzle(sql, { schema }), sql };
}

export type Db = ReturnType<typeof createDb>["db"];
