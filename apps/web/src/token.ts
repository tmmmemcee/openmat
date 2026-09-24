/**
 * Secret staff links look like /e/abc123/manage#k=TOKEN. The token lives in
 * the #hash (never sent to servers or logs); we move it into this browser's
 * storage and clean the address bar.
 *
 * Tokens are kept per screen type, so opening a table or weigh-in link on the
 * director's own device doesn't replace their director access. A screen uses
 * the director's token when there is one, otherwise its own.
 */
type Scope = "director" | "weigh-in" | "table";

const key = (slug: string, scope: Scope) => (scope === "director" ? `openmat:token:${slug}` : `openmat:token:${slug}:${scope}`);
const memory = new Map<string, string>();

/** Which kind of screen this is, from the address. */
function scopeOf(pathname = window.location.pathname): Scope {
  if (/\/weigh-in\/?$/.test(pathname)) return "weigh-in";
  if (/\/table\/\d+/.test(pathname)) return "table";
  return "director";
}

function read(k: string): string | null {
  try {
    return localStorage.getItem(k) ?? memory.get(k) ?? null;
  } catch {
    return memory.get(k) ?? null;
  }
}

function write(k: string, token: string): void {
  memory.set(k, token);
  try {
    localStorage.setItem(k, token);
  } catch {
    /* memory only */
  }
}

export function captureTokenFromHash(slug: string): void {
  const match = window.location.hash.match(/[#&]k=([\w-]+)/);
  if (!match) return;
  write(key(slug, scopeOf()), match[1]!);
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

/** The director's token wins when this browser has one (it can do everything); otherwise this screen's own. */
export function getToken(slug: string): string | null {
  const scope = scopeOf();
  return read(key(slug, "director")) ?? (scope !== "director" ? read(key(slug, scope)) : null);
}

/** Save the director's token (after creating an event or a demo). */
export function setToken(slug: string, token: string): void {
  write(key(slug, "director"), token);
}

export function forgetToken(slug: string): void {
  for (const scope of ["director", "weigh-in", "table"] as Scope[]) {
    memory.delete(key(slug, scope));
    try {
      localStorage.removeItem(key(slug, scope));
    } catch {
      /* ignore */
    }
  }
}

export function staffUrl(slug: string, path: string, token: string): string {
  return `${window.location.origin}/e/${slug}/${path}#k=${token}`;
}
