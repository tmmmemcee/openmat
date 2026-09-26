import { afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { createDb } from "../src/db/client.js";
import { memoryMailer } from "../src/mailer.js";
import { memoryNotifier } from "../src/services/notify.js";
import { serveUploads } from "../src/static.js";

const uploadsDir = mkdtempSync(path.join(tmpdir(), "openmat-uploads-"));
process.env.UPLOADS_DIR = uploadsDir;
const { db, sql } = createDb();
export const mailer = memoryMailer();
export const notifier = memoryNotifier();
export const app = await buildApp(db, { mailer, notifier });
await serveUploads(app, db, uploadsDir);

beforeEach(async () => {
  await sql`truncate events cascade`;
  await app.notifications.settle();
  mailer.sent.length = 0;
  notifier.sent.length = 0;
});
afterAll(async () => {
  await app.close();
  await sql.end();
  rmSync(uploadsDir, { recursive: true, force: true });
});

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

export const youthEvent = {
  name: "Winter Kids Classic",
  startDate: "2026-12-05",
  location: "Central High School",
  format: "madison",
  rulesetId: "usaw-kids-folkstyle-2025-26",
  settings: { mats: 2 },
  divisions: ["8U", "10U", "12U"].flatMap((age, i) =>
    (["boys", "girls"] as const).map((gender) => ({
      name: `${age} ${gender === "boys" ? "Boys" : "Girls"}`,
      ageDivision: age,
      maxAge: 8 + i * 2,
      gender,
      periodsSec: [60, 60, 60],
    })),
  ),
};

export async function createEvent(body: object = youthEvent) {
  const res = await app.inject({ method: "POST", url: "/api/events", payload: body });
  if (res.statusCode !== 201) throw new Error(res.body);
  const { slug, directorToken } = res.json();
  const info = (await app.inject({ url: `/api/events/${slug}`, headers: auth(directorToken) })).json();
  const weighInToken = info.staffLinks.find((l: { role: string }) => l.role === "weigh-in").token as string;
  return { slug, directorToken, weighInToken, info };
}
