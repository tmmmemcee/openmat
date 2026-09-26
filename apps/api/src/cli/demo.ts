/**
 * Builds two demo tournaments (youth and high school) mid-event and prints
 * their links.
 *
 *   pnpm --filter @openmat/api demo
 */
import { buildApp } from "../app.js";
import { directorUrl, PUBLIC_BASE_URL } from "../config.js";
import { createDb } from "../db/client.js";
import { memoryMailer } from "../mailer.js";
import { buildDemo } from "../services/demo.js";
import { memoryNotifier } from "../services/notify.js";

const { db, sql } = createDb();
const app = await buildApp(db, { mailer: memoryMailer(), notifier: memoryNotifier() });
const youth = await buildDemo(app, db, "youth", 2026);
const hs = await buildDemo(app, db, "high-school", 2027);
await app.notifications.settle();
console.log(`Demo Kids Classic:             ${PUBLIC_BASE_URL}/e/${youth.slug}`);
console.log(`  director: ${directorUrl(youth.slug, youth.directorToken)}`);
console.log(`Demo High School Invitational: ${PUBLIC_BASE_URL}/e/${hs.slug}`);
console.log(`  director: ${directorUrl(hs.slug, hs.directorToken)}`);
await app.close();
await sql.end();
