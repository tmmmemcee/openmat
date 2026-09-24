import { type GroupingEntry, evaluateGroup, groupWrestlers } from "@openmat/core";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../auth.js";
import type { Db } from "../db/client.js";
import { divisions, entries, groupMembers, groups } from "../db/schema.js";
import { HttpError } from "../errors.js";
import { loadDivisions, loadEvent } from "./events.js";

type Division = typeof divisions.$inferSelect;
type Entry = typeof entries.$inferSelect;

function toGroupingEntry(e: Entry, native: Division): GroupingEntry {
  return {
    id: e.id,
    name: `${e.firstName} ${e.lastName}`,
    weight: e.weight!,
    division: native.ageDivision ?? native.name,
    team: e.team,
    bumpAge: e.bumpAge,
    bumpWeight: e.bumpWeight,
  };
}

/** Everyone who should be in a group: weighed in and not scratched. */
async function groupable(db: Db, eventId: string): Promise<Entry[]> {
  return db
    .select()
    .from(entries)
    .where(and(eq(entries.eventId, eventId), isNotNull(entries.weight), ne(entries.status, "scratched")));
}

async function loadGroups(db: Db, eventId: string) {
  const gs = await db.select().from(groups).where(eq(groups.eventId, eventId));
  const members = gs.length
    ? await db.select().from(groupMembers).where(inArray(groupMembers.groupId, gs.map((g) => g.id)))
    : [];
  return gs.map((g) => ({ ...g, memberIds: members.filter((m) => m.groupId === g.id).map((m) => m.entryId) }));
}

/** Number groups 1, 2, 3... per division, lightest first. */
async function renumber(db: Db, eventId: string): Promise<void> {
  const gs = await loadGroups(db, eventId);
  const weights = new Map((await groupable(db, eventId)).map((e) => [e.id, e.weight!]));
  const byDivision = Map.groupBy(gs, (g) => g.divisionId);
  for (const list of byDivision.values()) {
    const minWeight = (g: (typeof gs)[number]) => Math.min(Infinity, ...g.memberIds.map((id) => weights.get(id) ?? Infinity));
    const sorted = [...list].sort((a, b) => minWeight(a) - minWeight(b) || a.number - b.number);
    for (const [i, g] of sorted.entries()) {
      if (g.number !== i + 1) await db.update(groups).set({ number: i + 1 }).where(eq(groups.id, g.id));
    }
  }
}

export function groupingRoutes(app: FastifyInstance, db: Db): void {
  /** Groups with their weight range, spread and flags, plus weighed-in wrestlers not in any group. */
  app.get<{ Params: { slug: string } }>("/api/events/:slug/groups", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id, "weigh-in", "table");
    const divs = await loadDivisions(db, event.id);
    const divById = new Map(divs.map((d) => [d.id, d]));
    const people = new Map((await groupable(db, event.id)).map((e) => [e.id, e]));
    const gs = await loadGroups(db, event.id);
    const grouped = new Set(gs.flatMap((g) => g.memberIds));

    return {
      groups: gs
        .map((g) => {
          const division = divById.get(g.divisionId)!;
          const members = g.memberIds.map((id) => people.get(id)).filter((e): e is Entry => !!e);
          const ageBumps = new Map(
            members
              .filter((m) => m.divisionId !== g.divisionId)
              .map((m) => [m.id, { from: divById.get(m.divisionId)!.name, to: division.name }]),
          );
          const evaluated = evaluateGroup(
            g.id,
            division.name,
            g.number,
            members.map((m) => toGroupingEntry(m, divById.get(m.divisionId)!)),
            event.settings.grouping,
            ageBumps,
          );
          return {
            id: g.id,
            divisionId: g.divisionId,
            number: g.number,
            locked: g.locked,
            memberIds: evaluated.members.map((m) => m.id),
            minWeight: evaluated.minWeight,
            maxWeight: evaluated.maxWeight,
            spreadPct: evaluated.spreadPct,
            flags: evaluated.flags,
          };
        })
        .sort((a, b) => divById.get(a.divisionId)!.sortOrder - divById.get(b.divisionId)!.sortOrder || a.number - b.number),
      ungroupedIds: [...people.keys()].filter((id) => !grouped.has(id)),
    };
  });

  /**
   * Group everyone automatically. Locked groups and their wrestlers are kept
   * as they are; every other group is rebuilt.
   */
  app.post<{ Params: { slug: string } }>("/api/events/:slug/groups/auto", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    if (event.format !== "madison") throw new HttpError(400, "Automatic grouping is for youth (Madison) events.");
    const divs = await loadDivisions(db, event.id);
    const divById = new Map(divs.map((d) => [d.id, d]));

    return db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      const existing = await loadGroups(txDb, event.id);
      const lockedIds = new Set(existing.filter((g) => g.locked).flatMap((g) => g.memberIds));
      const unlocked = existing.filter((g) => !g.locked).map((g) => g.id);
      if (unlocked.length) await tx.delete(groups).where(inArray(groups.id, unlocked));

      const people = (await groupable(txDb, event.id)).filter((e) => !lockedIds.has(e.id));
      const unplaced: { entryId: string; message: string }[] = [];
      let created = 0;

      for (const gender of ["boys", "girls", "mixed"] as const) {
        const genderDivs = divs.filter((d) => d.gender === gender && d.ageDivision && d.maxAge !== null);
        if (!genderDivs.length) continue;
        const byAge = new Map(genderDivs.map((d) => [d.ageDivision!, d]));
        const input = people
          .filter((e) => divById.get(e.divisionId)?.gender === gender)
          .map((e) => toGroupingEntry(e, divById.get(e.divisionId)!));
        if (!input.length) continue;

        let result;
        try {
          result = groupWrestlers(
            input,
            genderDivs.map((d) => ({ name: d.ageDivision!, maxAge: d.maxAge! })),
            event.settings.grouping,
          );
        } catch (err) {
          if (err instanceof RangeError) throw new HttpError(400, err.message);
          throw err;
        }
        for (const u of result.unplaced) unplaced.push({ entryId: u.entry.id, message: u.message });
        for (const g of result.groups) {
          const division = byAge.get(g.division)!;
          const [row] = await tx
            .insert(groups)
            .values({ eventId: event.id, divisionId: division.id, number: 1000 + created })
            .returning();
          await tx.insert(groupMembers).values(g.members.map((m) => ({ groupId: row!.id, entryId: m.id })));
          created++;
        }
      }
      await renumber(txDb, event.id);
      return { created, kept: existing.length - unlocked.length, unplaced };
    });
  });

  /** An empty group the director can drag wrestlers into. */
  app.post<{ Params: { slug: string } }>("/api/events/:slug/groups", async (req, reply) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    const { divisionId } = z.object({ divisionId: z.string().uuid() }).parse(req.body);
    const divs = await loadDivisions(db, event.id);
    if (!divs.some((d) => d.id === divisionId)) throw new HttpError(400, "That division isn't part of this event.");
    const count = (await db.select({ id: groups.id }).from(groups).where(eq(groups.divisionId, divisionId))).length;
    const [row] = await db.insert(groups).values({ eventId: event.id, divisionId, number: count + 1 }).returning();
    return reply.status(201).send(row);
  });

  app.patch<{ Params: { slug: string; id: string } }>("/api/events/:slug/groups/:id", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    const { locked } = z.object({ locked: z.boolean() }).parse(req.body);
    const updated = await db
      .update(groups)
      .set({ locked })
      .where(and(eq(groups.id, req.params.id), eq(groups.eventId, event.id)))
      .returning();
    if (!updated.length) throw new HttpError(404, "Group not found.");
    return updated[0];
  });

  /** Remove a group; its wrestlers become ungrouped. */
  app.delete<{ Params: { slug: string; id: string } }>("/api/events/:slug/groups/:id", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    const deleted = await db
      .delete(groups)
      .where(and(eq(groups.id, req.params.id), eq(groups.eventId, event.id)))
      .returning({ id: groups.id });
    if (!deleted.length) throw new HttpError(404, "Group not found.");
    await renumber(db, event.id);
    return { ok: true };
  });

  /** Move a wrestler to another group (or out of all groups with groupId null). Never into a younger age group. */
  app.put<{ Params: { slug: string; id: string } }>("/api/events/:slug/entries/:id/group", async (req) => {
    const event = await loadEvent(db, req.params.slug);
    await requireRole(db, req, event.id);
    const { groupId } = z.object({ groupId: z.string().uuid().nullable() }).parse(req.body);
    const [entry] = await db.select().from(entries).where(and(eq(entries.id, req.params.id), eq(entries.eventId, event.id)));
    if (!entry) throw new HttpError(404, "Wrestler not found.");

    if (groupId) {
      if (entry.weight === null || entry.status === "scratched") {
        throw new HttpError(400, `${entry.firstName} needs to be weighed in (and not scratched) to join a group.`);
      }
      const [group] = await db.select().from(groups).where(and(eq(groups.id, groupId), eq(groups.eventId, event.id)));
      if (!group) throw new HttpError(404, "Group not found.");
      const divs = await loadDivisions(db, event.id);
      const native = divs.find((d) => d.id === entry.divisionId)!;
      const target = divs.find((d) => d.id === group.divisionId)!;
      if (target.gender !== native.gender && target.gender !== "mixed") {
        throw new HttpError(400, `${target.name} is a different division from ${entry.firstName}'s.`);
      }
      if (native.maxAge !== null && target.maxAge !== null && target.maxAge < native.maxAge) {
        throw new HttpError(400, `${entry.firstName} can't wrestle down into ${target.name}. Wrestlers can only move up.`);
      }
    }

    await db.transaction(async (tx) => {
      await tx.delete(groupMembers).where(eq(groupMembers.entryId, entry.id));
      if (groupId) await tx.insert(groupMembers).values({ groupId, entryId: entry.id });
    });
    return { ok: true };
  });
}
