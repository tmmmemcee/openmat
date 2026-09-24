import { type WeightClassSet, checkWeighIn, nativeDivision } from "@openmat/core";
import { and, asc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { accessFor, requireRole } from "../auth.js";
import type { Db } from "../db/client.js";
import { divisions, entries, type EntryStatus, groupMembers } from "../db/schema.js";
import { HttpError } from "../errors.js";
import { loadDivisions, loadEvent } from "./events.js";

type Event = Awaited<ReturnType<typeof loadEvent>>;
type Division = typeof divisions.$inferSelect;
type Entry = typeof entries.$inferSelect;

const name = z.string().trim().min(1, "Required").max(60);
const optionalNumber = (min: number, max: number) => z.number().min(min).max(max).nullish();

const entryInput = z.object({
  firstName: name,
  lastName: name,
  team: z.string().trim().max(80).default(""),
  birthYear: z.number().int().min(1950).max(2100).nullish(),
  gender: z.enum(["boys", "girls"]).nullish(),
  divisionId: z.string().uuid().nullish(),
  declaredWeight: optionalNumber(20, 500),
  weightClass: z.string().trim().max(10).nullish(),
  contactEmail: z.string().trim().email().max(200).nullish().or(z.literal("").transform(() => null)),
  notes: z.string().trim().max(500).optional(),
});
type EntryInput = z.infer<typeof entryInput>;

const entryPatch = z.object({
  firstName: name.optional(),
  lastName: name.optional(),
  team: z.string().trim().max(80).optional(),
  birthYear: z.number().int().min(1950).max(2100).nullish(),
  divisionId: z.string().uuid().optional(),
  declaredWeight: optionalNumber(20, 500),
  weight: optionalNumber(20, 500),
  weightClass: z.string().trim().max(10).nullish(),
  bumpAge: z.number().int().min(0, "Wrestlers can only move up, never down").max(3).optional(),
  bumpWeight: z.number().int().min(0, "Wrestlers can only move up, never down").max(3).optional(),
  consent: z.boolean().optional(),
  status: z.enum(["registered", "weighed-in", "scratched"]).optional(),
  contactEmail: z.string().trim().email().max(200).nullish().or(z.literal("").transform(() => null)),
  notes: z.string().trim().max(500).optional(),
});

/** Fields the weigh-in table may change. */
const WEIGH_IN_FIELDS = new Set(["weight", "weightClass", "status"]);

function weightClassSet(d: Division): WeightClassSet | null {
  if (!d.weightClasses?.length) return null;
  return {
    name: d.name,
    classes: d.weightClasses.map((limit) => ({ name: String(limit), limit })),
    maxClassesUp: d.maxClassesUp,
  };
}

/** Pick the division for a new entry, from an explicit choice or birth year + gender. */
function resolveDivision(event: Event, divs: Division[], input: EntryInput): Division {
  if (input.divisionId) {
    const d = divs.find((x) => x.id === input.divisionId);
    if (!d) throw new HttpError(400, "That division isn't part of this event.");
    return d;
  }
  if (event.format === "madison") {
    if (!input.birthYear || !input.gender) throw new HttpError(400, "Enter a birth year and boys/girls, or pick a division.");
    const candidates = divs.filter((d) => d.gender === input.gender || d.gender === "mixed");
    const byName = new Map(candidates.map((d) => [d.ageDivision!, d]));
    const age = nativeDivision(
      input.birthYear,
      event.seasonYear,
      candidates.map((d) => ({ name: d.ageDivision!, maxAge: d.maxAge! })),
    );
    if (!age) throw new HttpError(400, `No age group in this event fits a wrestler born in ${input.birthYear}.`);
    return byName.get(age.name)!;
  }
  const matching = divs.filter((d) => !input.gender || d.gender === input.gender || d.gender === "mixed");
  if (matching.length === 1) return matching[0]!;
  throw new HttpError(400, "Pick a division.");
}

function validateWeightClass(d: Division, weightClass: string | null | undefined): void {
  if (!weightClass) return;
  if (!d.weightClasses?.map(String).includes(weightClass)) {
    throw new HttpError(400, `${weightClass} isn't a weight class in ${d.name}.`);
  }
}

/** Entry as sent to staff screens, with weigh-in check and group. */
function present(entry: Entry & { groupId: string | null }, divs: Division[]) {
  const d = divs.find((x) => x.id === entry.divisionId);
  const set = d && weightClassSet(d);
  const weighIn = set && entry.weight !== null && entry.weightClass ? checkWeighIn(entry.weight, entry.weightClass, set) : null;
  return { ...entry, weighIn };
}

async function listEntries(db: Db, eventId: string) {
  return db
    .select({ entry: entries, groupId: groupMembers.groupId })
    .from(entries)
    .leftJoin(groupMembers, eq(groupMembers.entryId, entries.id))
    .where(eq(entries.eventId, eventId))
    .orderBy(asc(entries.lastName), asc(entries.firstName));
}

async function findDuplicate(db: Db, eventId: string, input: EntryInput): Promise<boolean> {
  const rows = await db
    .select({ id: entries.id })
    .from(entries)
    .where(
      and(
        eq(entries.eventId, eventId),
        sql`lower(${entries.firstName}) = lower(${input.firstName})`,
        sql`lower(${entries.lastName}) = lower(${input.lastName})`,
        sql`lower(${entries.team}) = lower(${input.team})`,
      ),
    );
  return rows.length > 0;
}

function newEntryValues(event: Event, d: Division, input: EntryInput) {
  validateWeightClass(d, input.weightClass);
  return {
    eventId: event.id,
    divisionId: d.id,
    firstName: input.firstName,
    lastName: input.lastName,
    team: input.team,
    birthYear: input.birthYear ?? null,
    declaredWeight: input.declaredWeight ?? null,
    weightClass: input.weightClass ?? null,
    contactEmail: input.contactEmail ?? null,
    notes: input.notes ?? "",
  };
}

export function entryRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Params: { slug: string } }>("/api/events/:slug/entries", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id, "weigh-in", "table");
    const divs = await loadDivisions(db, event.id);
    const rows = await listEntries(db, event.id);
    return rows.map((r) => present({ ...r.entry, groupId: r.groupId }, divs));
  });

  /** Register one wrestler. Staff always; the public only while registration is open. */
  app.post<{ Params: { slug: string } }>("/api/events/:slug/entries", async (req, reply) => {
    const event = await loadEvent(db, req.params.slug);
    const access = await accessFor(db, req, event.id);
    const isStaff = access?.role === "director" || access?.role === "weigh-in";
    if (!isStaff && !event.settings.registrationOpen) throw new HttpError(403, "Registration for this event is closed.");
    const input = entryInput.parse(req.body);
    if (!isStaff) delete input.notes;
    const divs = await loadDivisions(db, event.id);
    const d = resolveDivision(event, divs, input);
    if (await findDuplicate(db, event.id, input)) {
      throw new HttpError(409, `${input.firstName} ${input.lastName}${input.team ? ` (${input.team})` : ""} is already entered.`);
    }
    const [created] = await db.insert(entries).values(newEntryValues(event, d, input)).returning();
    return reply.status(201).send(isStaff ? present({ ...created!, groupId: null }, divs) : { id: created!.id, division: d.name });
  });

  /** Bulk import (e.g. from a spreadsheet). Good rows are added; bad rows come back with the reason. */
  app.post<{ Params: { slug: string } }>("/api/events/:slug/entries/import", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    const { rows } = z.object({ rows: z.array(z.unknown()).min(1).max(5000) }).parse(req.body);
    const divs = await loadDivisions(db, event.id);
    const errors: { row: number; message: string }[] = [];
    const values: ReturnType<typeof newEntryValues>[] = [];
    const seen = new Set<string>();

    for (const [i, raw] of rows.entries()) {
      try {
        const input = entryInput.parse(raw);
        const key = `${input.firstName}|${input.lastName}|${input.team}`.toLowerCase();
        if (seen.has(key) || (await findDuplicate(db, event.id, input))) throw new HttpError(409, "Already entered");
        seen.add(key);
        values.push(newEntryValues(event, resolveDivision(event, divs, input), input));
      } catch (err) {
        const message =
          err instanceof z.ZodError
            ? err.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")
            : (err as Error).message;
        errors.push({ row: i + 1, message });
      }
    }
    if (values.length) await db.insert(entries).values(values);
    return { created: values.length, errors };
  });

  app.patch<{ Params: { slug: string; id: string } }>("/api/events/:slug/entries/:id", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    const access = await requireRole(db, req, event.id, "weigh-in");
    const patch = entryPatch.parse(req.body);
    if (access.role === "weigh-in") {
      const forbidden = Object.keys(patch).filter((k) => !WEIGH_IN_FIELDS.has(k));
      if (forbidden.length) throw new HttpError(403, `The weigh-in link can't change ${forbidden.join(", ")}.`);
    }
    const [entry] = await db.select().from(entries).where(and(eq(entries.id, req.params.id), eq(entries.eventId, event.id)));
    if (!entry) throw new HttpError(404, "Wrestler not found.");
    const divs = await loadDivisions(db, event.id);
    const division = divs.find((d) => d.id === (patch.divisionId ?? entry.divisionId));
    if (!division) throw new HttpError(400, "That division isn't part of this event.");
    validateWeightClass(division, patch.weightClass);

    if (patch.bumpAge) {
      const older = divs.filter(
        (d) => d.gender === division.gender && d.maxAge !== null && division.maxAge !== null && d.maxAge > division.maxAge,
      );
      if (older.length < patch.bumpAge) throw new HttpError(400, `There's no older age group to move ${entry.firstName} up to.`);
    }

    const update: Partial<Entry> = { ...patch };
    if (patch.weight !== undefined) {
      update.weighedAt = patch.weight === null ? null : new Date();
      if (!patch.status && entry.status !== "scratched") {
        update.status = (patch.weight === null ? "registered" : "weighed-in") satisfies EntryStatus;
      }
    }
    const [updated] = await db.update(entries).set(update).where(eq(entries.id, entry.id)).returning();
    // A scratched wrestler leaves their group.
    if (updated!.status === "scratched") await db.delete(groupMembers).where(eq(groupMembers.entryId, entry.id));
    const [membership] = await db.select().from(groupMembers).where(eq(groupMembers.entryId, entry.id));
    return present({ ...updated!, groupId: membership?.groupId ?? null }, divs);
  });

  app.delete<{ Params: { slug: string; id: string } }>("/api/events/:slug/entries/:id", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    const deleted = await db
      .delete(entries)
      .where(and(eq(entries.id, req.params.id), eq(entries.eventId, event.id)))
      .returning({ id: entries.id });
    if (!deleted.length) throw new HttpError(404, "Wrestler not found.");
    return { ok: true };
  });
}
