/**
 * Alerts for people following wrestlers: first match assigned, in the hole,
 * on deck, and results. Each alert goes out once (the notification log has a
 * unique key per follow), by web push or email.
 */
import { and, eq } from "drizzle-orm";
import webpush from "web-push";
import type { Db } from "../db/client.js";
import { entries, events, follows, notificationLog, type PushSubscriptionJson, serverSettings } from "../db/schema.js";
import type { Mailer } from "../mailer.js";
import { queues, snapshot } from "./snapshot.js";
import { type BoutView, BYE } from "./tournament.js";

export interface Alert {
  title: string;
  body: string;
  url: string;
}

export interface AlertTarget {
  channel: "push" | "email";
  subscription?: PushSubscriptionJson | null;
  email?: string | null;
}

export interface Notifier {
  /** "gone" means the device unsubscribed; the follow should be removed. */
  send(target: AlertTarget, alert: Alert): Promise<"ok" | "gone">;
  publicKey(): Promise<string>;
}

async function vapidKeys(db: Db): Promise<{ publicKey: string; privateKey: string }> {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const [row] = await db.select().from(serverSettings).where(eq(serverSettings.key, "vapid"));
  if (row) return row.value as { publicKey: string; privateKey: string };
  const keys = webpush.generateVAPIDKeys();
  await db.insert(serverSettings).values({ key: "vapid", value: keys }).onConflictDoNothing();
  const [saved] = await db.select().from(serverSettings).where(eq(serverSettings.key, "vapid"));
  return saved!.value as { publicKey: string; privateKey: string };
}

/** Web push (keys made once and kept in the database, or from env) and email. */
export function createNotifier(db: Db, mailer: Mailer): Notifier {
  let keys: Promise<{ publicKey: string; privateKey: string }> | null = null;
  const getKeys = () => (keys ??= vapidKeys(db));
  // Push services want a contact for the sender.
  const fromAddress = process.env.MAIL_FROM?.match(/<(.+)>/)?.[1];
  const subject = process.env.VAPID_SUBJECT ?? (fromAddress ? `mailto:${fromAddress}` : "mailto:admin@openmat.local");
  return {
    publicKey: async () => (await getKeys()).publicKey,
    async send(target, alert) {
      if (target.channel === "email" && target.email) {
        await mailer.send({ to: target.email, subject: alert.title, text: `${alert.body}\n\n${alert.url}\n\nTo stop these, unfollow on that page.` });
        return "ok";
      }
      if (target.channel === "push" && target.subscription) {
        const k = await getKeys();
        try {
          await webpush.sendNotification(target.subscription, JSON.stringify(alert), {
            vapidDetails: { subject, publicKey: k.publicKey, privateKey: k.privateKey },
            TTL: 600,
          });
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) return "gone";
          throw err;
        }
      }
      return "ok";
    },
  };
}

/** Collects alerts instead of sending (tests). */
export function memoryNotifier(): Notifier & { sent: { target: AlertTarget; alert: Alert }[] } {
  const sent: { target: AlertTarget; alert: Alert }[] = [];
  return {
    sent,
    publicKey: async () => "test-public-key",
    async send(target, alert) {
      sent.push({ target, alert });
      return "ok";
    },
  };
}

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  team: string;
}

/**
 * Alerts due right now for one follow. Keys make each alert unique per
 * wrestler and bout, so re-running this is safe.
 */
export function dueAlerts(
  wrestlerIds: string[],
  people: Map<string, Person>,
  bouts: BoutView[],
  queue: Map<string, { position: string; estimatedStart: string | null; bracketName: string }>,
  followedAt: Date,
  fmtTime: (iso: string) => string,
  url: string,
): { key: string; alert: Alert }[] {
  const out: { key: string; alert: Alert }[] = [];
  const name = (id: string | null | undefined) => (id && id !== BYE ? `${people.get(id)?.firstName ?? ""} ${people.get(id)?.lastName ?? ""}`.trim() : null);
  for (const w of wrestlerIds) {
    const who = name(w) ?? "Your wrestler";
    const mine = bouts.filter((b) => b.a === w || b.b === w);
    const opponent = (b: BoutView) => {
      const other = b.a === w ? b.b : b.a;
      return name(other) ?? (b.a === w ? b.bFrom : b.aFrom) ?? "TBD";
    };

    // First scheduled bout.
    const upcoming = mine
      .filter((b) => b.mat && (b.status === "ready" || b.status === "waiting"))
      .sort((x, y) => (x.plannedStartMin ?? 0) - (y.plannedStartMin ?? 0));
    const played = mine.some((b) => b.status === "done" || b.status === "wrestling");
    const first = upcoming[0];
    if (first && !played) {
      const q = queue.get(first.id);
      out.push({
        key: `${w}:first`,
        alert: {
          title: `${who}: first match on Mat ${first.mat}`,
          body: `Bout ${first.boutNumber} vs ${opponent(first)}${q?.estimatedStart ? `, around ${fmtTime(q.estimatedStart)}` : ""}.`,
          url,
        },
      });
    }

    for (const b of mine) {
      const q = queue.get(b.id);
      if (q?.position === "in-the-hole") {
        out.push({
          key: `${b.id}:${w}:hole`,
          alert: {
            title: `${who} is in the hole on Mat ${b.mat}`,
            body: `Bout ${b.boutNumber} vs ${opponent(b)}${q.estimatedStart ? ` · about ${fmtTime(q.estimatedStart)}` : ""}.`,
            url,
          },
        });
      }
      if (q?.position === "on-deck") {
        out.push({
          key: `${b.id}:${w}:deck`,
          alert: { title: `${who} is on deck on Mat ${b.mat}!`, body: `Bout ${b.boutNumber} vs ${opponent(b)}. Head to the mat.`, url },
        });
      }
      if (b.status === "done" && b.result && b.endedAt && b.endedAt > followedAt && !b.conflict) {
        const won = b.winnerEntryId === w;
        out.push({
          key: `${b.id}:${w}:result`,
          alert: {
            title: `${who} ${won ? "won" : "lost"}`,
            body: `${b.result.summary} ${won ? "over" : "to"} ${opponent(b)} (bout ${b.boutNumber}${q?.bracketName ? `, ${q.bracketName}` : ""}).`,
            url,
          },
        });
      }
    }
  }
  return out;
}

/** Work out and send any alerts that are due for an event. */
export async function runNotifications(db: Db, eventId: string, notifier: Notifier, baseUrl: string): Promise<number> {
  const fs = await db.select().from(follows).where(eq(follows.eventId, eventId));
  if (!fs.length) return 0;
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event) return 0;
  const snap = await snapshot(db, event);
  const views = snap.views;
  const bouts = views.flatMap((b) => b.bouts);
  const queue = new Map<string, { position: string; estimatedStart: string | null; bracketName: string }>();
  for (const items of queues(snap, event.settings.mats).values()) {
    for (const i of items) queue.set(i.bout.id, { position: i.position, estimatedStart: i.estimatedStart, bracketName: i.bracketName });
  }
  const bracketOf = new Map(views.flatMap((v) => v.bouts.map((b) => [b.id, v.name] as const)));
  for (const b of bouts) if (!queue.has(b.id)) queue.set(b.id, { position: "", estimatedStart: null, bracketName: bracketOf.get(b.id) ?? "" });

  const roster = await db
    .select({ id: entries.id, firstName: entries.firstName, lastName: entries.lastName, team: entries.team })
    .from(entries)
    .where(eq(entries.eventId, eventId));
  const people = new Map(roster.map((p) => [p.id, p]));
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: event.timezone });
  const url = `${baseUrl}/e/${event.slug}/follow`;

  let sent = 0;
  for (const f of fs) {
    const ids = f.entryId ? [f.entryId] : roster.filter((p) => f.team && p.team.toLowerCase() === f.team.toLowerCase()).map((p) => p.id);
    const due = dueAlerts(ids, people, bouts, queue, f.createdAt, fmtTime, url);
    for (const d of due) {
      // Claim the alert first, so two runs at once can't both send it.
      const claimed = await db.insert(notificationLog).values({ followId: f.id, key: d.key }).onConflictDoNothing().returning();
      if (!claimed.length) continue;
      try {
        const res = await notifier.send(f, d.alert);
        sent++;
        if (res === "gone") {
          await db.delete(follows).where(eq(follows.id, f.id));
          break;
        }
      } catch (err) {
        // Let it be retried next time.
        await db.delete(notificationLog).where(and(eq(notificationLog.followId, f.id), eq(notificationLog.key, d.key)));
        console.error("alert failed", err);
      }
    }
  }
  return sent;
}

/** Runs notifications shortly after changes, one run at a time per event. */
export class NotificationScheduler {
  private timers = new Map<string, NodeJS.Timeout>();
  private running = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: Db,
    private readonly notifier: Notifier,
    private readonly baseUrl: string,
    private readonly delayMs = 400,
  ) {}

  /**
   * Run soon after a change. Changes that arrive while a run is already
   * pending join it rather than pushing it back, so a busy event with
   * constant scoring still gets its alerts promptly.
   */
  poke(eventId: string): void {
    if (this.timers.has(eventId)) return;
    this.timers.set(
      eventId,
      setTimeout(() => {
        this.timers.delete(eventId);
        void this.runNow(eventId);
      }, this.delayMs),
    );
  }

  async runNow(eventId: string): Promise<void> {
    const prev = this.running.get(eventId) ?? Promise.resolve();
    const next = prev.then(() => runNotifications(this.db, eventId, this.notifier, this.baseUrl)).catch((err) => console.error("notifications failed", err));
    this.running.set(eventId, next);
    await next;
  }

  /** Wait for pending runs (tests, shutdown). */
  async settle(): Promise<void> {
    for (const [id, t] of this.timers) {
      clearTimeout(t);
      this.timers.delete(id);
      await this.runNow(id);
    }
    await Promise.all(this.running.values());
  }
}
