/** Where the web app lives, for links in emails. */
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? "http://localhost:5173").replace(/\/$/, "");

/** Comma-separated list of origins the API will respond to. Comma-separated so
 * the Blueprint env var is a single string. */
export const CORS_ORIGINS: string[] = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function directorUrl(slug: string, token: string, base = PUBLIC_BASE_URL): string {
  return `${base}/e/${slug}/manage#k=${token}`;
}
