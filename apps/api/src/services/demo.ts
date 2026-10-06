/**
 * Demo tournaments, built through the real API and played out to mid-event:
 *   - "youth": a youth event grouped by weight (round robins) on 3 mats
 *   - "high-school": a high school invitational with seeds and double
 *     elimination on 4 mats
 *   - "meet": a youth scratch tri-meet, auto-paired across three teams
 * Youth and meet kids come from saved team rosters (with private experience
 * levels and ratings), so the coach and director features have data.
 * Finished bouts get realistic times, one bout per mat is live, and the rest
 * are waiting in line. Used by the `demo` command and the home page's
 * "Try the live demo".
 */
import { type Corner, type ExperienceLevel, seedRating, seededRandom } from "@openmat/core";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Db } from "../db/client.js";
import { hashToken, newToken } from "../auth.js";
import { bouts, events, teams as teamsTable, wrestlers } from "../db/schema.js";
import { bumpVersion } from "./snapshot.js";

export type DemoKind = "youth" | "high-school" | "meet";

export interface Demo {
  slug: string;
  directorToken: string;
  /** Coach link for one of the demo's saved teams. */
  coach?: { teamId: string; token: string };
}

const FIRST = ["Liam","Noah","Oliver","Elijah","James","Lucas","Mason","Ethan","Logan","Jack","Aiden","Owen","Wyatt","Levi","Caleb","Hudson","Ryan","Carter","Grayson","Eli","Colton","Jaxon","Easton","Cole","Brody","Kai","Gavin","Nolan","Chase","Tyler","Hunter","Bryce","Tanner","Cooper","Jace","Austin","Blake","Drew","Gage","Reid","Ava","Mia","Ella","Zoe","Lily","Ruby","Nora","Ivy"];
const LAST = ["Smith","Johnson","Brown","Garcia","Miller","Davis","Wilson","Moore","Taylor","Anderson","Thomas","Jackson","White","Harris","Martin","Thompson","Olson","Berg","Nguyen","Schmidt","Larson","Hansen","Peterson","Kelly"];

const localNow = (tz: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
};
const hhmm = (min: number) => `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((min % 60) + 60) % 60).padStart(2, "0")}`;

export async function buildDemo(app: FastifyInstance, db: Db, kind: DemoKind, seed = Date.now()): Promise<Demo> {
const rand = seededRandom(seed);
const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)]!;

async function call<T = any>(method: "GET" | "POST" | "PATCH", url: string, token?: string, payload?: unknown): Promise<T> {
  const res = await app.inject({ method, url: `/api${url}`, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} -> ${res.statusCode}: ${res.body}`);
  return res.body ? (res.json() as T) : (undefined as T);
}

/** A realistic result for a bout under folkstyle rules. */
function fakeResult(): { winner: Corner; winType: string; score?: { A: number; B: number }; matchTimeSec?: number } {
  const winner: Corner = rand() < 0.5 ? "A" : "B";
  const loser: Corner = winner === "A" ? "B" : "A";
  const r = rand();
  const lose = Math.floor(rand() * 5);
  if (r < 0.42) return { winner, winType: "DEC", score: { [winner]: lose + 1 + Math.floor(rand() * 7), [loser]: lose } as { A: number; B: number } };
  if (r < 0.57) return { winner, winType: "MD", score: { [winner]: lose + 8 + Math.floor(rand() * 7), [loser]: lose } as { A: number; B: number } };
  if (r < 0.67) {
    const low = Math.floor(rand() * 3);
    return { winner, winType: "TF", score: { [winner]: low + 15 + Math.floor(rand() * 3), [loser]: low } as { A: number; B: number }, matchTimeSec: 150 + Math.floor(rand() * 200) };
  }
  if (r < 0.95) return { winner, winType: "FALL", matchTimeSec: 20 + Math.floor(rand() * 330) };
  return { winner, winType: "FOR" };
}

let tapId = 0;
const tap = (e: object) => ({ id: `demo-${Date.now().toString(36)}-${++tapId}`, ...e });

/** Score a bout tap by tap (as a table would), then finish it. Unfinished bouts are left mid-match with the clock stopped. */
async function scoreLive(slug: string, boutId: string, token: string, finish: boolean, periodsSec: number[]) {
  const events = [];
  // A valid folkstyle sequence: takedown, escape, takedown, near fall, reversal, escape.
  const plan: [Corner, string][] = [["A", "T3"], ["B", "E1"], ["A", "T3"], ["A", "N2"], ["B", "R2"], ["A", "E1"]];
  const total = periodsSec.reduce((a, b) => a + b, 0);
  const step = total / (plan.length + 2);
  const periodAt = (t: number) => {
    let end = 0;
    for (const [i, len] of periodsSec.entries()) {
      end += len;
      if (t < end) return { period: i + 1, remainingSec: end - t };
    }
    return { period: periodsSec.length, remainingSec: 0 };
  };
  let t = 0;
  for (const [corner, action] of plan.slice(0, finish ? plan.length : 3)) {
    t += Math.round(step * (0.6 + rand() * 0.8));
    events.push(tap({ type: "score", corner, action, period: periodAt(t).period, matchTimeSec: t }));
  }
  if (finish) events.push(tap({ type: "penalty", corner: "B", kind: "stalling", period: periodsSec.length, matchTimeSec: Math.min(total - 5, t + 10) }));
  await call("POST", `/events/${slug}/bouts/${boutId}/start`, token);
  await call("POST", `/events/${slug}/bouts/${boutId}/events`, token, { events });
  if (finish) await call("POST", `/events/${slug}/bouts/${boutId}/finish`, token, { mode: "live", ending: { type: "time" } });
  else {
    const now = periodAt(t + 8);
    await call("POST", `/events/${slug}/bouts/${boutId}/clock`, token, { period: now.period, remainingSec: Math.max(1, now.remainingSec), running: false });
  }
}

/** Wrestle about `share` of each mat's line, then set realistic past times and start one bout per mat. */
async function playOut(slug: string, director: string, share: number, pace: number) {
  const info = await call("GET", `/events/${slug}`, director);
  const tableToken = (mat: number) => info.staffLinks.find((l: any) => l.role === "table" && l.mat === mat).token as string;
  const periodsOf = new Map<string, number[]>(info.divisions.map((d: any) => [d.id, d.periodsSec]));
  const bracketDivision = new Map<string, string>((await call("GET", `/events/${slug}/brackets`)).brackets.map((b: any) => [b.id, b.divisionId]));
  const periods = (bout: any) => periodsOf.get(bracketDivision.get(bout.bracketId)!) ?? info.divisions[0].periodsSec;
  for (let round = 0; round < 200; round++) {
    let progressed = false;
    for (let mat = 1; mat <= info.settings.mats; mat++) {
      const q = await call("GET", `/events/${slug}/mats/${mat}`);
      const total = q.queue.length + q.recent.length;
      const doneOnMat = (await call("GET", `/events/${slug}/brackets`)).brackets.flatMap((b: any) => b.bouts).filter((b: any) => b.mat === mat && b.status === "done").length;
      if (doneOnMat >= Math.floor((doneOnMat + q.queue.length) * share) && total) continue;
      const next = q.queue.find((x: any) => x.bout.status === "ready");
      if (!next) continue;
      progressed = true;
      if (rand() < 0.3) await scoreLive(slug, next.bout.id, tableToken(mat), true, periods(next.bout));
      else await call("POST", `/events/${slug}/bouts/${next.bout.id}/finish`, tableToken(mat), { mode: "manual", ...fakeResult() });
    }
    if (!progressed) break;
  }
  // Spread finished bouts back in time at each mat's pace.
  const all = (await call("GET", `/events/${slug}/brackets`)).brackets.flatMap((b: any) => b.bouts);
  const now = Date.now();
  for (let mat = 1; mat <= info.settings.mats; mat++) {
    const done = all.filter((b: any) => b.mat === mat && b.status === "done").sort((x: any, y: any) => new Date(x.endedAt).getTime() - new Date(y.endedAt).getTime());
    for (const [i, b] of done.entries()) {
      const endedAt = new Date(now - (done.length - i) * pace * 60000 - rand() * 60000);
      const startedAt = new Date(endedAt.getTime() - (pace - 1.5) * 60000);
      await db.update(bouts).set({ startedAt, endedAt }).where(eq(bouts.id, b.id));
    }
    // One bout live on each mat.
    const q = await call("GET", `/events/${slug}/mats/${mat}`);
    const next = q.queue.find((x: any) => x.bout.status === "ready");
    if (next) {
      await scoreLive(slug, next.bout.id, tableToken(mat), false, periods(next.bout));
      await db.update(bouts).set({ startedAt: new Date(now - 90_000) }).where(eq(bouts.id, next.bout.id));
    }
  }
  // Times were edited directly in the database, so refresh cached views.
  const [row] = await db.select({ id: events.id }).from(events).where(eq(events.slug, slug));
  await bumpVersion(db, row!.id);
  return info;
}

async function youthEvent() {
  const tz = "America/Chicago";
  const today = localNow(tz);
  const { slug, directorToken } = await call("POST", "/events", undefined, {
    name: "Demo Kids Classic",
    startDate: today.date,
    startTime: hhmm(today.minutes - 100),
    timezone: tz,
    location: "Lincoln Middle School",
    city: "Des Moines",
    state: "IA",
    format: "madison",
    rulesetId: "usaw-kids-folkstyle-2025-26",
    settings: { mats: 3, registrationOpen: true },
    divisions: [["8U", 8], ["10U", 10], ["12U", 12]].flatMap(([age, maxAge]) =>
      (["boys", "girls"] as const).map((gender) => ({
        name: `${age} ${gender === "boys" ? "Boys" : "Girls"}`,
        ageDivision: age,
        maxAge,
        gender,
        periodsSec: Number(maxAge) <= 10 ? [60, 60, 60] : [60, 90, 90],
      })),
    ),
  });
  const clubs = await savedTeams(["Hawkeye WC", "Valley Vikings", "Ankeny Elite", "Urbandale Youth"], 14);
  for (const club of clubs) await register(slug, club);
  const info = await call("GET", `/events/${slug}`, directorToken);
  const weighIn = info.staffLinks.find((l: any) => l.role === "weigh-in").token;
  const entries = await call<any[]>("GET", `/events/${slug}/entries`, directorToken);
  for (const [i, e] of entries.entries()) {
    if (i % 23 === 7) continue; // didn't make it to weigh-ins
    if (i % 31 === 11) {
      await call("PATCH", `/events/${slug}/entries/${e.id}`, weighIn, { status: "scratched" });
      continue;
    }
    await call("PATCH", `/events/${slug}/entries/${e.id}`, weighIn, { weight: Math.round((e.declaredWeight + (rand() - 0.5) * 3) * 10) / 10 });
  }
  // A young kid wrestling up an age group, with the parent's OK.
  const young = entries.find((e) => e.birthYear === 2019);
  if (young) await call("PATCH", `/events/${slug}/entries/${young.id}`, directorToken, { bumpAge: 1, consent: true });
  await call("POST", `/events/${slug}/groups/auto`, directorToken);
  const { groups } = await call("GET", `/events/${slug}/groups`, directorToken);
  if (groups[0]) await call("PATCH", `/events/${slug}/groups/${groups[0].id}`, directorToken, { locked: true });
  await call("POST", `/events/${slug}/brackets/generate`, directorToken, { format: "auto", roundRobinUpTo: 5 });
  await call("POST", `/events/${slug}/brackets/schedule`, directorToken, {});
  await playOut(slug, directorToken, 0.55, 5);
  return { slug, directorToken, coach: { teamId: clubs[0]!.id, token: clubs[0]!.token } };
}

/**
 * Teams with saved rosters, made straight in the database (demo-flagged, so
 * they're cleaned up with the demos). Kids get an experience level from
 * years wrestled, and older hands a rating that results have moved.
 */
async function savedTeams(names: string[], kids: number) {
  const out = [];
  for (const name of names) {
    const token = newToken();
    const [team] = await db.insert(teamsTable).values({ name, tokenHash: hashToken(token), isDemo: true }).returning();
    const rows = Array.from({ length: kids }, () => {
      const birthYear = 2015 + Math.floor(rand() * 5);
      const girl = rand() < 0.15;
      const years = Math.min(2026 - birthYear - 4, Math.floor(rand() * 6));
      const level: ExperienceLevel = years <= 1 ? "novice" : years <= 3 ? "intermediate" : "advanced";
      const ratedMatches = years === 0 ? 0 : years * 4 + Math.floor(rand() * 6);
      return {
        teamId: team!.id,
        firstName: girl ? pick(FIRST.slice(40)) : pick(FIRST.slice(0, 40)),
        lastName: pick(LAST),
        birthYear,
        gender: girl ? ("girls" as const) : ("boys" as const),
        weight: 45 + (2020 - birthYear) * 7 + Math.round(rand() * 200) / 10,
        weightUpdatedAt: new Date(Date.now() - Math.floor(rand() * 20) * 86_400_000),
        level,
        yearsWrestled: years,
        rating: seedRating(level) + (ratedMatches ? Math.round((rand() - 0.5) * 240) : 0),
        ratedMatches,
      };
    });
    const saved = await db.insert(wrestlers).values(rows).returning({ id: wrestlers.id });
    out.push({ id: team!.id, name, token, wrestlerIds: saved.map((w) => w.id) });
  }
  return out;
}

/** The coach registers their whole saved roster, as from the roster page. */
async function register(slug: string, team: { id: string; token: string; wrestlerIds: string[] }) {
  await call("POST", `/teams/${team.id}/register`, team.token, { eventSlug: slug, wrestlers: team.wrestlerIds.map((wrestlerId) => ({ wrestlerId })) });
}

async function meetEvent() {
  const tz = "America/Chicago";
  const today = localNow(tz);
  const { slug, directorToken } = await call("POST", "/events", undefined, {
    name: "Demo Youth Tri-Meet",
    startDate: today.date,
    startTime: hhmm(today.minutes - 45),
    timezone: tz,
    location: "Roosevelt High School",
    city: "Des Moines",
    state: "IA",
    format: "meet",
    rulesetId: "usaw-kids-folkstyle-2025-26",
    settings: { mats: 2, registrationOpen: true, meet: { matchesPerKid: 2 } },
    divisions: [["8U", 8], ["10U", 10], ["12U", 12]].flatMap(([age, maxAge]) =>
      (["boys", "girls"] as const).map((gender) => ({
        name: `${age} ${gender === "boys" ? "Boys" : "Girls"}`,
        ageDivision: age,
        maxAge,
        gender,
        periodsSec: Number(maxAge) <= 10 ? [60, 60, 60] : [60, 90, 90],
      })),
    ),
  });
  const clubs = await savedTeams(["Hawkeye WC", "Valley Vikings", "Ankeny Elite"], 12);
  for (const club of clubs) await register(slug, club);
  await call("POST", `/events/${slug}/pairings/auto`, directorToken, {});
  await call("POST", `/events/${slug}/brackets/schedule`, directorToken, {});
  await playOut(slug, directorToken, 0.45, 4);
  return { slug, directorToken, coach: { teamId: clubs[0]!.id, token: clubs[0]!.token } };
}

async function highSchoolEvent() {
  const tz = "America/Chicago";
  const today = localNow(tz);
  const { slug, directorToken } = await call("POST", "/events", undefined, {
    name: "Demo High School Invitational",
    startDate: today.date,
    startTime: hhmm(today.minutes - 150),
    timezone: tz,
    location: "Valley High School",
    city: "West Des Moines",
    state: "IA",
    format: "weight-classes",
    rulesetId: "nfhs-2025-26",
    settings: { mats: 4, registrationOpen: false },
    divisions: [{ name: "Boys", gender: "boys", weightClasses: [106, 113, 120, 126, 132, 138], maxClassesUp: 1, periodsSec: [120, 120, 120] }],
  });
  const teams = ["Ankeny", "Dowling", "Valley", "Waukee", "Ames", "Johnston", "Southeast Polk", "Urbandale"];
  const rows = [];
  for (const w of [106, 113, 120, 126, 132, 138]) {
    const n = 6 + Math.floor(rand() * 7);
    for (let i = 0; i < n; i++) rows.push({ firstName: pick(FIRST.slice(0, 40)), lastName: pick(LAST), team: teams[(i + w) % teams.length], weightClass: String(w) });
  }
  await call("POST", `/events/${slug}/entries/import`, directorToken, { rows });
  const entries = await call<any[]>("GET", `/events/${slug}/entries`, directorToken);
  const byClass = Map.groupBy(entries, (e) => e.weightClass);
  for (const [cls, list] of byClass) {
    for (const [i, e] of list.entries()) {
      await call("PATCH", `/events/${slug}/entries/${e.id}`, directorToken, { weight: Number(cls) - rand() * 2.5, ...(i < 2 ? { seed: i + 1 } : {}) });
    }
  }
  await call("POST", `/events/${slug}/brackets/generate`, directorToken, { format: "double-elim", places: 6 });
  await call("POST", `/events/${slug}/brackets/schedule`, directorToken, {});
  await playOut(slug, directorToken, 0.5, 7);
  return { slug, directorToken };
}

return kind === "youth" ? youthEvent() : kind === "meet" ? meetEvent() : highSchoolEvent();
}
