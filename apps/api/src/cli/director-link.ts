/**
 * For whoever runs the site: issue a new director link for an event, e.g.
 * when the director lost theirs and didn't leave an email.
 *
 *   pnpm --filter @openmat/api director-link <slug>
 */
import { eq } from "drizzle-orm";
import { createAccessLink } from "../auth.js";
import { createDb } from "../db/client.js";
import { events } from "../db/schema.js";
import { directorUrl } from "../config.js";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: director-link <event slug>");
  process.exit(1);
}
const { db, sql } = createDb();
const [event] = await db.select().from(events).where(eq(events.slug, slug));
if (!event) {
  console.error(`No event with slug "${slug}".`);
  await sql.end();
  process.exit(1);
}
const token = await createAccessLink(db, event.id, "director");
console.log(`New director link for "${event.name}":\n${directorUrl(slug, token)}`);
await sql.end();
