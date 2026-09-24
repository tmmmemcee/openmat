import { getToken } from "./token";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; slug?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const token = options.slug ? getToken(options.slug) : null;
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your internet connection.");
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

// ---- Types returned by the API ----

export type Gender = "boys" | "girls" | "mixed";
export type Role = "director" | "weigh-in" | "table";

export interface Division {
  id: string;
  name: string;
  ageDivision: string | null;
  maxAge: number | null;
  gender: Gender;
  weightClasses: number[] | null;
  maxClassesUp: number;
  periodsSec: number[];
  sortOrder: number;
}

export interface EventSettings {
  mats: number;
  restMin: number;
  registrationOpen: boolean;
  grouping: { targetSize: number; minSize: number; maxSize: number; maxSpreadPct: number; spreadFloor: number };
}

export interface EventInfo {
  slug: string;
  name: string;
  startDate: string;
  location: string;
  format: "madison" | "weight-classes";
  seasonYear: number;
  ruleset?: { id: string; name: string; summary: string; links: { label: string; url: string }[] };
  settings: EventSettings;
  divisions: Division[];
  access: { role: Role; mat: number | null } | null;
  staffLinks?: { id: string; role: Role; mat: number | null; token: string }[];
}

export type WeighInCheck =
  | { status: "ok"; weightClass: { name: string }; classesUp: number }
  | { status: "missed-weight"; declared: { name: string }; suggested: { name: string }; overBy: number }
  | { status: "too-far-up"; declared: { name: string }; natural: { name: string }; maxClassesUp: number }
  | { status: "over-max"; heaviestLimit: number }
  | { status: "unknown-class"; declared: string };

export interface Entry {
  id: string;
  divisionId: string;
  firstName: string;
  lastName: string;
  team: string;
  birthYear: number | null;
  declaredWeight: number | null;
  weight: number | null;
  weighedAt: string | null;
  weightClass: string | null;
  bumpAge: number;
  bumpWeight: number;
  consent: boolean;
  status: "registered" | "weighed-in" | "scratched";
  contactEmail: string | null;
  notes: string;
  groupId: string | null;
  weighIn: WeighInCheck | null;
}

export type GroupFlag =
  | { type: "weight-spread"; spreadPct: number; allowedPct: number }
  | { type: "undersized"; size: number; minSize: number }
  | { type: "alone"; wrestlerId: string }
  | { type: "wrestling-up-age"; wrestlerId: string; from: string; to: string }
  | { type: "wrestling-up-weight"; wrestlerId: string; groupsUp: number };

export interface Group {
  id: string;
  divisionId: string;
  number: number;
  locked: boolean;
  memberIds: string[];
  minWeight: number;
  maxWeight: number;
  spreadPct: number;
  flags: GroupFlag[];
}

export interface Templates {
  rulesets: { id: string; name: string; style: string; season: string; periodsSec: number[]; minRestMin: number; summary: string }[];
  ageDivisions: { name: string; maxAge: number }[];
  weightClassPresets: { name: string; limits: number[]; maxClassesUp: number }[];
}
