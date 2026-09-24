import { randomBytes } from "node:crypto";
import { and, asc, eq, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { divisions, entries, follows } from "../db/schema.js";
import { HttpError } from "../errors.js";
import { RateLimiter } from "../rateLimit.js";
import { matQueues } from "../services/live.js";
import type { NotificationScheduler, Notifier } from "../services/notify.js";
import { BYE, loadBracketViews } from "../services/tournament.js";
import { loadEvent } from "./events.js";

const subscription = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

export function followRoutes(app: FastifyInstance, db: Db, notifier: Notifier, scheduler: NotificationScheduler): void {
  const limiter = new RateLimiter(60, 60 * 60 * 1000);

  app.get("/api/push/key", async () => ({ publicKey: await notifier.publicKey() }));

  /** Everyone entered (not scratched): names, teams, divisions. Public, for finding a wrestler to follow. */
  app.get<{ Params: { slug: string } }>("/api/events/:slug/roster", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    const rows = await db
      .select({ id: entries.id, firstName: entries.firstName, lastName: entries.lastName, team: entries.team, division: divisions.name })
      .from(entries)
      .innerJoin(divisions, eq(divisions.id, entries.divisionId))
      .where(and(eq(entries.eventId, event.id), ne(entries.status, "scratched")))
      .orderBy(asc(entries.lastName), asc(entries.firstName));
    return rows;
  });

  /** Follow a wrestler or a team and get alerts by push or email. Returns a secret the device keeps to unfollow. */
  app.post<{ Params: { slug: string } }>("/api/events/:slug/follows", async (req, reply) => {
    const event = await loadEvent(db, req.params.slug);
    if (!limiter.allow(req.ip)) throw new HttpError(429, "Too many requests. Please wait a bit.");
    const input = z
      .object({
        entryId: z.string().uuid().optional(),
        team: z.string().trim().min(1).max(80).optional(),
        channel: z.enum(["push", "email"]),
        subscription: subscription.optional(),
        email: z.string().trim().toLowerCase().email().max(200).optional(),
      })
      .refine((v) => !!v.entryId !== !!v.team, "Follow either one wrestler or one team")
      .refine((v) => (v.channel === "push" ? !!v.subscription : !!v.email), "Missing where to send alerts")
      .parse(req.body);
    if (input.entryId) {
      const [e] = await db.select({ id: entries.id }).from(entries).where(and(eq(entries.id, input.entryId), eq(entries.eventId, event.id)));
      if (!e) throw new HttpError(404, "Wrestler not found.");
    }
    const secret = randomBytes(18).toString("base64url");
    const [row] = await db
      .insert(follows)
      .values({
        eventId: event.id,
        entryId: input.entryId ?? null,
        team: input.team ?? null,
        channel: input.channel,
        subscription: input.subscription ?? null,
        email: input.email ?? null,
        secret,
      })
      .returning({ id: follows.id });
    scheduler.poke(event.id);
    return reply.status(201).send({ id: row!.id, secret });
  });

  app.delete<{ Params: { id: string } }>("/api/follows/:id", async (req) => {
    const { secret } = z.object({ secret: z.string().max(100) }).parse(req.body ?? {});
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, "Not found.");
    await db.delete(follows).where(and(eq(follows.id, id.data), eq(follows.secret, secret)));
    return { ok: true };
  });

  /** Where followed wrestlers stand: next bout (mat, place in line, time) and results so far. */
  app.post<{ Params: { slug: string } }>("/api/events/:slug/wrestler-status", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    const { ids } = z.object({ ids: z.array(z.string().uuid()).max(100) }).parse(req.body);
    if (!ids.length) return [];
    const views = await loadBracketViews(db, event.id);
    const queue = new Map<string, { position: string; estimatedStart: string | null }>();
    for (const items of matQueues(views, event.settings.mats).values()) for (const i of items) queue.set(i.bout.id, i);
    const people = await db
      .select({ id: entries.id, firstName: entries.firstName, lastName: entries.lastName, team: entries.team, status: entries.status })
      .from(entries)
      .where(eq(entries.eventId, event.id));
    const byId = new Map(people.map((p) => [p.id, p]));
    const name = (id: string | null) => (id && id !== BYE ? `${byId.get(id)?.firstName} ${byId.get(id)?.lastName}` : null);
    const wanted = people.filter((p) => ids.includes(p.id));

    return wanted.map((p) => {
      const bracket = views.find((b) => b.draw.includes(p.id));
      const mine = (bracket?.bouts ?? []).filter((b) => b.a === p.id || b.b === p.id);
      const opponent = (b: (typeof mine)[number]) => name(b.a === p.id ? b.b : b.a) ?? (b.a === p.id ? b.bFrom : b.aFrom) ?? "TBD";
      const next = mine
        .filter((b) => b.status === "wrestling" || b.status === "ready" || b.status === "waiting")
        .sort((x, y) => (x.status === "wrestling" ? -1 : 0) - (y.status === "wrestling" ? -1 : 0) || (x.plannedStartMin ?? 0) - (y.plannedStartMin ?? 0))[0];
      const q = next ? queue.get(next.id) : undefined;
      return {
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        team: p.team,
        scratched: p.status === "scratched",
        bracket: bracket ? { id: bracket.id, name: bracket.name } : null,
        next: next
          ? {
              boutNumber: next.boutNumber,
              mat: next.mat,
              status: next.status,
              position: q?.position ?? null,
              estimatedStart: q?.estimatedStart ?? null,
              opponent: opponent(next),
            }
          : null,
        results: mine
          .filter((b) => b.status === "done" && b.result)
          .sort((x, y) => (x.endedAt?.getTime() ?? 0) - (y.endedAt?.getTime() ?? 0))
          .map((b) => ({ boutNumber: b.boutNumber, won: b.winnerEntryId === p.id, summary: b.result!.summary, opponent: opponent(b) })),
        place: bracket?.places.find((x) => x.entryId === p.id)?.place ?? null,
      };
    });
  });
}

