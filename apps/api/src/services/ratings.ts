/**
 * Keep saved wrestlers' private ratings in step with results. Each finished
 * bout between two saved wrestlers records how much it moved each rating, so
 * a correction recomputes it and a reset undoes it.
 */
import { type WinType, ratingDelta } from "@openmat/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { bouts, entries, ratingChanges, wrestlers } from "../db/schema.js";

/** Undo whatever this bout did to ratings. */
export async function revertBoutRating(db: Db, boutId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const changes = await tx.select().from(ratingChanges).where(eq(ratingChanges.boutId, boutId));
    for (const c of changes) {
      await tx
        .update(wrestlers)
        .set({ rating: sql`${wrestlers.rating} - ${c.delta}`, ratedMatches: sql`greatest(${wrestlers.ratedMatches} - 1, 0)` })
        .where(eq(wrestlers.id, c.wrestlerId));
    }
    await tx.delete(ratingChanges).where(eq(ratingChanges.boutId, boutId));
  });
}

/** Apply (or re-apply after a correction) this bout's effect on both wrestlers' ratings. */
export async function applyBoutRating(db: Db, boutId: string): Promise<void> {
  await revertBoutRating(db, boutId);
  const [bout] = await db.select().from(bouts).where(eq(bouts.id, boutId));
  if (!bout?.winnerEntryId || !bout.result || !bout.entryA || !bout.entryB) return;
  const loserEntryId = bout.winnerEntryId === bout.entryA ? bout.entryB : bout.entryA;
  const linked = await db
    .select({ entryId: entries.id, wrestlerId: entries.wrestlerId })
    .from(entries)
    .where(inArray(entries.id, [bout.winnerEntryId, loserEntryId]));
  const winnerId = linked.find((l) => l.entryId === bout.winnerEntryId)?.wrestlerId;
  const loserId = linked.find((l) => l.entryId === loserEntryId)?.wrestlerId;
  if (!winnerId || !loserId || winnerId === loserId) return;

  await db.transaction(async (tx) => {
    const people = await tx.select().from(wrestlers).where(inArray(wrestlers.id, [winnerId, loserId]));
    const w = people.find((p) => p.id === winnerId)!;
    const l = people.find((p) => p.id === loserId)!;
    const delta = ratingDelta({ rating: w.rating, matches: w.ratedMatches }, { rating: l.rating, matches: l.ratedMatches }, bout.result!.winType as WinType);
    if (delta === 0) return;
    for (const [id, d] of [
      [winnerId, delta],
      [loserId, -delta],
    ] as const) {
      await tx.insert(ratingChanges).values({ boutId, wrestlerId: id, delta: d });
      await tx
        .update(wrestlers)
        .set({ rating: sql`${wrestlers.rating} + ${d}`, ratedMatches: sql`${wrestlers.ratedMatches} + 1` })
        .where(and(eq(wrestlers.id, id)));
    }
  });
}
