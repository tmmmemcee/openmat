/**
 * Builds three demo tournaments (youth, high school, tri-meet) mid-event and
 * prints their links.
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
const meet = await buildDemo(app, db, "meet", 2028);
await app.notifications.settle();
console.log(`Demo Kids Classic:             ${PUBLIC_BASE_URL}/e/${youth.slug}`);
console.log(`  director: ${directorUrl(youth.slug, youth.directorToken)}`);
console.log(`Demo High School Invitational: ${PUBLIC_BASE_URL}/e/${hs.slug}`);
console.log(`  director: ${directorUrl(hs.slug, hs.directorToken)}`);
console.log(`Demo Youth Tri-Meet:           ${PUBLIC_BASE_URL}/e/${meet.slug}`);
console.log(`  director: ${directorUrl(meet.slug, meet.directorToken)}`);
console.log(`  coach (Hawkeye WC roster): ${PUBLIC_BASE_URL}/t/${youth.coach!.teamId}#k=${youth.coach!.token}`);
await app.close();
await sql.end();
