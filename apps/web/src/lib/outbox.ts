/**
 * Scoring taps are saved on this device first and sent to the server in the
 * background. If the gym Wi-Fi drops, scoring keeps working; taps sync when
 * the connection comes back. Each tap has its own id, so re-sending is safe.
 */
import { useEffect, useSyncExternalStore } from "react";
import { api } from "../api";

export interface OutboxItem {
  boutId: string;
  event: Record<string, unknown> & { id: string };
}

const key = (slug: string) => `openmat:outbox:${slug}`;
const listeners = new Set<() => void>();
const memory = new Map<string, OutboxItem[]>();
const cache = new Map<string, OutboxItem[]>();

function read(slug: string): OutboxItem[] {
  const cached = cache.get(slug);
  if (cached) return cached;
  let items: OutboxItem[] = memory.get(slug) ?? [];
  try {
    const raw = localStorage.getItem(key(slug));
    if (raw) items = JSON.parse(raw) as OutboxItem[];
  } catch {
    /* storage unavailable: memory only */
  }
  cache.set(slug, items);
  return items;
}

function write(slug: string, items: OutboxItem[]): void {
  cache.set(slug, items);
  memory.set(slug, items);
  try {
    localStorage.setItem(key(slug), JSON.stringify(items));
  } catch {
    /* memory only */
  }
  for (const l of listeners) l();
}

/** Random id that works even on plain http (no crypto.randomUUID). */
export function newEventId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `e${Date.now().toString(36)}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function enqueue(slug: string, boutId: string, event: Record<string, unknown>): OutboxItem {
  const item = { boutId, event: { ...event, id: (event.id as string) ?? newEventId(), at: new Date().toISOString() } };
  write(slug, [...read(slug), item]);
  void flush(slug);
  return item;
}

export function pendingFor(slug: string, boutId?: string): OutboxItem[] {
  const all = read(slug);
  return boutId ? all.filter((i) => i.boutId === boutId) : all;
}

let flushing = false;

/** Send everything waiting, bout by bout, in order. Stops at the first failure and tries again later. */
export async function flush(slug: string): Promise<boolean> {
  if (flushing) return false;
  flushing = true;
  try {
    for (;;) {
      const items = read(slug);
      if (!items.length) return true;
      const boutId = items[0]!.boutId;
      const batch = items.filter((i) => i.boutId === boutId).slice(0, 100);
      try {
        await api(`/events/${slug}/bouts/${boutId}/events`, { method: "POST", slug, body: { events: batch.map((b) => b.event) } });
      } catch (err) {
        const status = (err as { status?: number }).status ?? 0;
        // Offline or server hiccup: keep and retry. A rejected batch (4xx) would block forever, so drop it.
        if (status === 0 || status >= 500) return false;
        console.error("Scoring events rejected", err);
      }
      const sent = new Set(batch.map((b) => b.event.id));
      write(slug, read(slug).filter((i) => !sent.has(i.event.id)));
    }
  } finally {
    flushing = false;
  }
}

/** Pending taps for this event, re-rendering as they change; keeps retrying in the background. */
export function useOutbox(slug: string): OutboxItem[] {
  const items = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(slug),
  );
  useEffect(() => {
    const retry = () => void flush(slug);
    const t = setInterval(retry, 4000);
    window.addEventListener("online", retry);
    retry();
    return () => {
      clearInterval(t);
      window.removeEventListener("online", retry);
    };
  }, [slug]);
  return items;
}
