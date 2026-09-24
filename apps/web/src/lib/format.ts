import type { Entry } from "../api";

export const fullName = (e: Pick<Entry, "firstName" | "lastName">) => `${e.firstName} ${e.lastName}`;

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function lbs(w: number | null | undefined): string {
  return w === null || w === undefined ? "—" : `${Number.isInteger(w) ? w : w.toFixed(1)} lb`;
}

export function periods(sec: number[]): string {
  return sec.map((s) => (s % 60 === 0 ? String(s / 60) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`)).join("-");
}
