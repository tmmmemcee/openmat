import { RULESETS } from "@openmat/core";
import { and, asc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { accessFor, createAccessLink, requireRole } from "../auth.js";
import { directorUrl } from "../config.js";
import type { Db } from "../db/client.js";
import { accessLinks, divisions, entries, events, type EventSettings } from "../db/schema.js";
import { HttpError } from "../errors.js";
import { publicCache } from "../httpCache.js";
import { customAlphabet } from "../ids.js";
import type { Mailer } from "../mailer.js";
import { RateLimiter } from "../rateLimit.js";
import { templates } from "../templates.js";

const newSlug = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 6);

const divisionInput = z.object({
  name: z.string().trim().min(1).max(60),
  ageDivision: z.string().trim().max(20).nullish(),
  maxAge: z.number().int().min(3).max(99).nullish(),
  gender: z.enum(["boys", "girls", "mixed"]),
  weightClasses: z.array(z.number().positive()).min(1).max(40).nullish(),
  maxClassesUp: z.number().int().min(0).max(3).default(1),
  periodsSec: z.array(z.number().int().min(10).max(600)).min(1).max(5),
});

const settingsInput = z.object({
  mats: z.number().int().min(1).max(40),
  restMin: z.number().int().min(0).max(120),
  registrationOpen: z.boolean(),
  grouping: z.object({
    targetSize: z.number().int().min(2).max(8),
    minSize: z.number().int().min(1).max(8),
    maxSize: z.number().int().min(2).max(16),
    maxSpreadPct: z.number().min(0).max(50),
    spreadFloor: z.number().min(0).max(30),
  }),
});

const email = z.string().trim().toLowerCase().email("That email doesn't look right").max(200);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00");
const state = z.string().trim().toUpperCase().max(3);

const createEventInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-05"),
    startTime: time.nullish(),
    timezone: z
      .string()
      .max(60)
      .refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "Unknown time zone")
      .optional(),
    location: z.string().trim().max(200).default(""),
    city: z.string().trim().max(80).default(""),
    state: state.default(""),
    listed: z.boolean().default(true),
    directorEmail: email.nullish().or(z.literal("").transform(() => null)),
    format: z.enum(["madison", "weight-classes"]),
    rulesetId: z.string().refine((id) => RULESETS.some((r) => r.id === id), "Unknown rule set"),
    seasonYear: z.number().int().min(2000).max(2100).optional(),
    settings: settingsInput.partial().default({}),
    divisions: z.array(divisionInput).min(1).max(60),
  })
  .superRefine((v, ctx) => {
    for (const [i, d] of v.divisions.entries()) {
      if (v.format === "madison" && (!d.ageDivision || !d.maxAge)) {
        ctx.addIssue({ code: "custom", path: ["divisions", i], message: `${d.name} needs an age group for youth grouping` });
      }
      if (v.format === "weight-classes" && !d.weightClasses?.length) {
        ctx.addIssue({ code: "custom", path: ["divisions", i], message: `${d.name} needs weight classes` });
      }
    }
  });

export const DEFAULT_SETTINGS: EventSettings = {
  mats: 4,
  restMin: 30,
  registrationOpen: false,
  grouping: { targetSize: 4, minSize: 3, maxSize: 5, maxSpreadPct: 10, spreadFloor: 0 },
};

/** Season year for age divisions: a season starting in the fall counts as the next year (Dec 2026 -> 2027). */
export function seasonYearFor(date: string): number {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return m >= 8 ? y + 1 : y;
}

export async function loadEvent(db: Db, slug: string) {
  const [event] = await db.select().from(events).where(eq(events.slug, slug));
  if (!event) throw new HttpError(404, "We couldn't find that event. Check the link.");
  return event;
}

export async function loadDivisions(db: Db, eventId: string) {
  return db.select().from(divisions).where(eq(divisions.eventId, eventId)).orderBy(asc(divisions.sortOrder));
}

function directorEmailText(links: { name: string; url: string }[]): string {
  return [
    `Here ${links.length === 1 ? "is your director link" : "are your director links"} for OpenMat.`,
    "",
    ...links.flatMap((l) => [l.name, l.url, ""]),
    "Anyone with a director link can manage the tournament, so keep it private.",
  ].join("\n");
}

export function eventRoutes(app: FastifyInstance, db: Db, mailer: Mailer): void {
  const recoverLimiter = new RateLimiter(5, 60 * 60 * 1000);

  app.get("/api/templates", async () => templates());

  /** Public tournament list with filters. Only events marked as listed. */
  app.get("/api/events", async (req, reply) => {
    reply.header("cache-control", "public, max-age=30");
    const q = z
      .object({
        q: z.string().trim().max(100).optional(),
        state: z.string().trim().toUpperCase().max(3).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        format: z.enum(["madison", "weight-classes"]).optional(),
        open: z.enum(["true", "false"]).optional(),
      })
      .parse(req.query);
    const today = new Date().toISOString().slice(0, 10);
    const conditions = [eq(events.listed, true), eq(events.isDemo, false), gte(events.startDate, q.from ?? today)];
    if (q.to) conditions.push(lte(events.startDate, q.to));
    if (q.state) conditions.push(eq(events.state, q.state));
    if (q.format) conditions.push(eq(events.format, q.format));
    if (q.open === "true") conditions.push(sql`(${events.settings}->>'registrationOpen')::boolean = true`);
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      conditions.push(or(ilike(events.name, like), ilike(events.city, like), ilike(events.location, like))!);
    }
    const rows = await db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(asc(events.startDate), asc(events.startTime), asc(events.name))
      .limit(200);
    const ids = rows.map((r) => r.id);
    const divs = ids.length ? await db.select().from(divisions).where(inArray(divisions.eventId, ids)).orderBy(asc(divisions.sortOrder)) : [];
    const counts = ids.length
      ? await db
          .select({ eventId: entries.eventId, n: sql<number>`count(*)::int` })
          .from(entries)
          .where(and(inArray(entries.eventId, ids), ne(entries.status, "scratched")))
          .groupBy(entries.eventId)
      : [];
    const states = await db
      .selectDistinct({ state: events.state })
      .from(events)
      .where(and(eq(events.listed, true), eq(events.isDemo, false), gte(events.startDate, today), ne(events.state, "")))
      .orderBy(asc(events.state));
    return {
      events: rows.map((e) => ({
        slug: e.slug,
        name: e.name,
        startDate: e.startDate,
        startTime: e.startTime,
        location: e.location,
        city: e.city,
        state: e.state,
        format: e.format,
        registrationOpen: e.settings.registrationOpen,
        divisions: divs.filter((d) => d.eventId === e.id).map((d) => d.name),
        wrestlers: counts.find((c) => c.eventId === e.id)?.n ?? 0,
      })),
      states: states.map((s) => s.state),
    };
  });

  /**
   * Lost director link: email fresh links for every tournament with this
   * director email. Always answers the same way, so it can't be used to find
   * out who runs what.
   */
  app.post("/api/recover", async (req) => {
    const input = z.object({ email }).parse(req.body);
    if (!recoverLimiter.allow(`ip:${req.ip}`) || !recoverLimiter.allow(`email:${input.email}`)) {
      throw new HttpError(429, "Too many tries. Please wait an hour and try again.");
    }
    const owned = await db.select().from(events).where(eq(events.directorEmail, input.email)).orderBy(asc(events.startDate));
    if (owned.length) {
      const links = [];
      for (const e of owned) {
        links.push({ name: `${e.name} (${e.startDate})`, url: directorUrl(e.slug, await createAccessLink(db, e.id, "director")) });
      }
      await mailer.send({ to: input.email, subject: "Your OpenMat director links", text: directorEmailText(links) });
    }
    return { ok: true };
  });

  app.post("/api/events", async (req, reply) => {
    const input = createEventInput.parse(req.body);
    const ruleset = RULESETS.find((r) => r.id === input.rulesetId)!;
    const settings: EventSettings = {
      ...DEFAULT_SETTINGS,
      restMin: ruleset.minRestMin ?? DEFAULT_SETTINGS.restMin,
      ...input.settings,
      grouping: { ...DEFAULT_SETTINGS.grouping, ...input.settings.grouping },
    };

    const result = await db.transaction(async (tx) => {
      let slug = newSlug();
      while ((await tx.select({ id: events.id }).from(events).where(eq(events.slug, slug))).length) slug = newSlug();
      const [event] = await tx
        .insert(events)
        .values({
          slug,
          name: input.name,
          startDate: input.startDate,
          startTime: input.startTime ?? null,
          ...(input.timezone ? { timezone: input.timezone } : {}),
          location: input.location,
          city: input.city,
          state: input.state,
          listed: input.listed,
          directorEmail: input.directorEmail ?? null,
          format: input.format,
          rulesetId: input.rulesetId,
          seasonYear: input.seasonYear ?? seasonYearFor(input.startDate),
          settings,
        })
        .returning();
      await tx.insert(divisions).values(
        input.divisions.map((d, i) => ({
          eventId: event!.id,
          name: d.name,
          ageDivision: d.ageDivision ?? null,
          maxAge: d.maxAge ?? null,
          gender: d.gender,
          weightClasses: d.weightClasses ?? null,
          maxClassesUp: d.maxClassesUp,
          periodsSec: d.periodsSec,
          sortOrder: i,
        })),
      );
      const txDb = tx as unknown as Db;
      const directorToken = await createAccessLink(txDb, event!.id, "director");
      await createAccessLink(txDb, event!.id, "weigh-in");
      for (let mat = 1; mat <= settings.mats; mat++) await createAccessLink(txDb, event!.id, "table", mat);
      return { event: event!, directorToken };
    });

    if (result.event.directorEmail) {
      await mailer
        .send({
          to: result.event.directorEmail,
          subject: `Your director link: ${result.event.name}`,
          text: directorEmailText([
            { name: `${result.event.name} (${result.event.startDate})`, url: directorUrl(result.event.slug, result.directorToken) },
          ]),
        })
        .catch((err) => req.log.error(err, "director email failed"));
    }
    return reply.status(201).send({ slug: result.event.slug, directorToken: result.directorToken });
  });

  /** Public event info. Staff also get their role; directors get staff links. */
  app.get<{ Params: { slug: string } }>("/api/events/:slug", async (req, reply) => {
    const event = await loadEvent(db, req.params.slug);
    if (publicCache(req, reply, `e${event.version}`, 10)) return reply;
    const access = await accessFor(db, req, event.id);
    const divs = await loadDivisions(db, event.id);
    const ruleset = RULESETS.find((r) => r.id === event.rulesetId);
    const staffLinks =
      access?.role === "director"
        ? await db
            .select({ id: accessLinks.id, role: accessLinks.role, mat: accessLinks.mat, token: accessLinks.token })
            .from(accessLinks)
            .where(and(eq(accessLinks.eventId, event.id), ne(accessLinks.role, "director"), isNull(accessLinks.revokedAt)))
            .orderBy(asc(accessLinks.role), asc(accessLinks.mat))
        : undefined;
    return {
      slug: event.slug,
      name: event.name,
      startDate: event.startDate,
      startTime: event.startTime,
      timezone: event.timezone,
      location: event.location,
      city: event.city,
      state: event.state,
      listed: event.listed,
      isDemo: event.isDemo,
      format: event.format,
      seasonYear: event.seasonYear,
      ruleset: ruleset && { id: ruleset.id, name: ruleset.name, summary: ruleset.summary, links: ruleset.links },
      settings: event.settings,
      divisions: divs,
      access: access ? { role: access.role, mat: access.mat } : null,
      ...(staffLinks ? { staffLinks, directorEmail: event.directorEmail } : {}),
    };
  });

  app.patch<{ Params: { slug: string } }>("/api/events/:slug", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    const input = z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        startTime: time.nullish(),
        location: z.string().trim().max(200).optional(),
        city: z.string().trim().max(80).optional(),
        state: state.optional(),
        listed: z.boolean().optional(),
        directorEmail: email.nullish().or(z.literal("").transform(() => null)),
        settings: settingsInput.partial().optional(),
      })
      .parse(req.body);
    const settings = input.settings
      ? { ...event.settings, ...input.settings, grouping: { ...event.settings.grouping, ...input.settings.grouping } }
      : event.settings;

    await db.transaction(async (tx) => {
      await tx
        .update(events)
        .set({
          name: input.name,
          startDate: input.startDate,
          startTime: input.startTime,
          location: input.location,
          city: input.city,
          state: input.state,
          listed: input.listed,
          directorEmail: input.directorEmail,
          settings,
        })
        .where(eq(events.id, event.id));
      // Keep one table link per mat.
      if (settings.mats !== event.settings.mats) {
        const tables = await tx
          .select()
          .from(accessLinks)
          .where(and(eq(accessLinks.eventId, event.id), eq(accessLinks.role, "table"), isNull(accessLinks.revokedAt)));
        for (let mat = 1; mat <= settings.mats; mat++) {
          if (!tables.some((t) => t.mat === mat)) await createAccessLink(tx as unknown as Db, event.id, "table", mat);
        }
        for (const t of tables.filter((t) => (t.mat ?? 0) > settings.mats)) {
          await tx.update(accessLinks).set({ revokedAt: new Date() }).where(eq(accessLinks.id, t.id));
        }
      }
    });
    return { ok: true };
  });

  /** Replace a staff link (e.g. it was shared with the wrong person). */
  app.post<{ Params: { slug: string; linkId: string } }>("/api/events/:slug/links/:linkId/reset", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    const [link] = await db
      .select()
      .from(accessLinks)
      .where(and(eq(accessLinks.id, req.params.linkId), eq(accessLinks.eventId, event.id), isNull(accessLinks.revokedAt)));
    if (!link || link.role === "director") throw new HttpError(404, "Link not found.");
    await db.update(accessLinks).set({ revokedAt: new Date() }).where(eq(accessLinks.id, link.id));
    const token = await createAccessLink(db, event.id, link.role, link.mat ?? undefined);
    return { token };
  });
}
