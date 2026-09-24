/** Where the web app lives, for links in emails. */
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? "http://localhost:5173").replace(/\/$/, "");

export function directorUrl(slug: string, token: string, base = PUBLIC_BASE_URL): string {
  return `${base}/e/${slug}/manage#k=${token}`;
}
