/** Where the web app lives, for links in emails. */
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? "http://localhost:5173").replace(/\/$/, "");

/** The official public web app. Always allowed, so the hosted site works even if hosting settings don't apply. */
export const OFFICIAL_WEB_ORIGINS = ["https://openmat-web.onrender.com"];

/**
 * Origins the API answers cross-origin requests from: the official web app,
 * wherever PUBLIC_BASE_URL points, local development, and anything listed in
 * CORS_ORIGIN (comma-separated).
 */
export const CORS_ORIGINS: string[] = [
  ...new Set(
    [
      ...OFFICIAL_WEB_ORIGINS,
      new URL(PUBLIC_BASE_URL).origin,
      "http://localhost:5173",
      ...(process.env.CORS_ORIGIN ?? "").split(","),
    ]
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean),
  ),
];

export function directorUrl(slug: string, token: string, base = PUBLIC_BASE_URL): string {
  return `${base}/e/${slug}/manage#k=${token}`;
}
