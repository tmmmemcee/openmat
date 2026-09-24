/**
 * Secret staff links look like /e/abc123/manage#k=TOKEN. The token lives in
 * the #hash (never sent to servers or logs); we move it into this browser's
 * storage and clean the address bar.
 */
const key = (slug: string) => `openmat:token:${slug}`;

export function captureTokenFromHash(slug: string): void {
  const match = window.location.hash.match(/[#&]k=([\w-]+)/);
  if (!match) return;
  try {
    localStorage.setItem(key(slug), match[1]!);
  } catch {
    memory.set(slug, match[1]!);
  }
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

const memory = new Map<string, string>();

export function getToken(slug: string): string | null {
  try {
    return localStorage.getItem(key(slug)) ?? memory.get(slug) ?? null;
  } catch {
    return memory.get(slug) ?? null;
  }
}

export function setToken(slug: string, token: string): void {
  try {
    localStorage.setItem(key(slug), token);
  } catch {
    memory.set(slug, token);
  }
}

export function forgetToken(slug: string): void {
  try {
    localStorage.removeItem(key(slug));
  } catch {
    /* ignore */
  }
  memory.delete(slug);
}

export function staffUrl(slug: string, path: string, token: string): string {
  return `${window.location.origin}/e/${slug}/${path}#k=${token}`;
}
