/**
 * Following wrestlers on this device. The list lives in this browser; turning
 * on alerts also registers each follow with the server (push or email).
 */
import { useSyncExternalStore } from "react";
import { api } from "../api";

export type AlertChannel = { channel: "push"; subscription: PushSubscriptionJSON } | { channel: "email"; email: string };

interface Following {
  wrestlers: string[];
  teams: string[];
  alerts: AlertChannel | null;
  /** Server follows by "w:<entryId>" / "t:<team>". */
  server: Record<string, { id: string; secret: string }>;
}

const empty = (): Following => ({ wrestlers: [], teams: [], alerts: null, server: {} });
const key = (slug: string) => `openmat:following:${slug}`;
const cache = new Map<string, Following>();
const listeners = new Set<() => void>();

function read(slug: string): Following {
  const hit = cache.get(slug);
  if (hit) return hit;
  let value = empty();
  try {
    const raw = localStorage.getItem(key(slug));
    if (raw) value = { ...empty(), ...(JSON.parse(raw) as Following) };
  } catch {
    /* ignore */
  }
  cache.set(slug, value);
  return value;
}

function write(slug: string, value: Following): void {
  cache.set(slug, value);
  try {
    localStorage.setItem(key(slug), JSON.stringify(value));
  } catch {
    /* memory only */
  }
  for (const l of listeners) l();
}

export function useFollowing(slug: string): Following {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(slug),
  );
}

async function register(slug: string, target: string, alerts: AlertChannel): Promise<{ id: string; secret: string }> {
  const [kind, ...rest] = target.split(":");
  const value = rest.join(":");
  return api(`/events/${slug}/follows`, { method: "POST", body: { ...(kind === "w" ? { entryId: value } : { team: value }), ...alerts } });
}

async function unregister(f: { id: string; secret: string }): Promise<void> {
  await api(`/follows/${f.id}`, { method: "DELETE", body: { secret: f.secret } }).catch(() => undefined);
}

export async function follow(slug: string, what: { wrestler?: string; team?: string }): Promise<void> {
  const s = read(slug);
  const target = what.wrestler ? `w:${what.wrestler}` : `t:${what.team}`;
  const next: Following = {
    ...s,
    wrestlers: what.wrestler && !s.wrestlers.includes(what.wrestler) ? [...s.wrestlers, what.wrestler] : s.wrestlers,
    teams: what.team && !s.teams.includes(what.team) ? [...s.teams, what.team] : s.teams,
  };
  write(slug, next);
  if (s.alerts && !s.server[target]) {
    const reg = await register(slug, target, s.alerts);
    write(slug, { ...read(slug), server: { ...read(slug).server, [target]: reg } });
  }
}

export async function unfollow(slug: string, what: { wrestler?: string; team?: string }): Promise<void> {
  const s = read(slug);
  const target = what.wrestler ? `w:${what.wrestler}` : `t:${what.team}`;
  const { [target]: removed, ...server } = s.server;
  write(slug, {
    ...s,
    wrestlers: s.wrestlers.filter((w) => w !== what.wrestler),
    teams: s.teams.filter((t) => t !== what.team),
    server,
  });
  if (removed) await unregister(removed);
}

/** Turn alerts on for everything followed (or switch channel). */
export async function enableAlerts(slug: string, alerts: AlertChannel): Promise<void> {
  await disableAlerts(slug);
  const s = read(slug);
  const server: Following["server"] = {};
  for (const target of [...s.wrestlers.map((w) => `w:${w}`), ...s.teams.map((t) => `t:${t}`)]) {
    server[target] = await register(slug, target, alerts);
  }
  write(slug, { ...read(slug), alerts, server });
}

export async function disableAlerts(slug: string): Promise<void> {
  const s = read(slug);
  write(slug, { ...s, alerts: null, server: {} });
  await Promise.all(Object.values(s.server).map(unregister));
}

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Ask permission and subscribe this device to push alerts. */
export async function pushSubscription(): Promise<PushSubscriptionJSON> {
  if (!pushSupported()) throw new Error("This browser can't do push alerts. Use email alerts instead.");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Alerts are blocked for this site. Allow notifications in your browser settings, or use email alerts.");
  const { publicKey } = await api<{ publicKey: string }>("/push/key");
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(publicKey) }));
  return sub.toJSON();
}
