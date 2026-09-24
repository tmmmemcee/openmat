import { describe, expect, it } from "vitest";
import { app, auth, createEvent } from "./helpers.js";

async function setup(weights: number[], birthYear = 2018) {
  const ev = await createEvent();
  const h = auth(ev.directorToken);
  const ids: string[] = [];
  for (const [i, w] of weights.entries()) {
    const e = (await app.inject({
      method: "POST",
      url: `/api/events/${ev.slug}/entries`,
      headers: h,
      payload: { firstName: `Kid${i}`, lastName: "Test", team: `T${i % 3}`, birthYear, gender: "boys" },
    })).json();
    await app.inject({ method: "PATCH", url: `/api/events/${ev.slug}/entries/${e.id}`, headers: h, payload: { weight: w } });
    ids.push(e.id);
  }
  const groups = async () => (await app.inject({ url: `/api/events/${ev.slug}/groups`, headers: h })).json();
  const auto = async () => (await app.inject({ method: "POST", url: `/api/events/${ev.slug}/groups/auto`, headers: h })).json();
  return { ...ev, h, ids, groups, auto };
}

describe("grouping", () => {
  it("groups weighed-in wrestlers and numbers groups lightest first", async () => {
    const s = await setup([60, 61, 62, 63, 70, 71, 72, 74]);
    expect((await s.auto()).created).toBe(2);
    const { groups, ungroupedIds } = await s.groups();
    expect(ungroupedIds).toEqual([]);
    expect(groups.map((g: { number: number; minWeight: number }) => [g.number, g.minWeight])).toEqual([
      [1, 60],
      [2, 70],
    ]);
    expect(groups.every((g: { flags: unknown[] }) => g.flags.length === 0)).toBe(true);
  });

  it("keeps locked groups when regrouping", async () => {
    const s = await setup([60, 61, 62, 63, 70, 71, 72, 74]);
    await s.auto();
    const first = (await s.groups()).groups[0];
    await app.inject({ method: "PATCH", url: `/api/events/${s.slug}/groups/${first.id}`, headers: s.h, payload: { locked: true } });
    const again = await s.auto();
    expect(again.kept).toBe(1);
    const { groups } = await s.groups();
    expect(groups.find((g: { id: string }) => g.id === first.id).memberIds.sort()).toEqual(first.memberIds.sort());
  });

  it("moves a wrestler by hand and flags the result; refuses moving down an age group", async () => {
    const s = await setup([60, 61, 62, 63, 80, 81, 82, 83]);
    await s.auto();
    const [light, heavy] = (await s.groups()).groups;
    // Move the lightest kid into the heavy group: now it breaks the 10% rule.
    await app.inject({ method: "PUT", url: `/api/events/${s.slug}/entries/${light.memberIds[0]}/group`, headers: s.h, payload: { groupId: heavy.id } });
    const after = (await s.groups()).groups.find((g: { id: string }) => g.id === heavy.id);
    expect(after.flags.some((f: { type: string }) => f.type === "weight-spread")).toBe(true);

    // An 8U group, then try to move a 10U kid into it.
    const younger = (await app.inject({
      method: "POST",
      url: `/api/events/${s.slug}/entries`,
      headers: s.h,
      payload: { firstName: "Tiny", lastName: "Kid", birthYear: 2020, gender: "boys" },
    })).json();
    await app.inject({ method: "PATCH", url: `/api/events/${s.slug}/entries/${younger.id}`, headers: s.h, payload: { weight: 45 } });
    await s.auto();
    const eightU = (await s.groups()).groups.find((g: { memberIds: string[] }) => g.memberIds.includes(younger.id));
    const down = await app.inject({ method: "PUT", url: `/api/events/${s.slug}/entries/${s.ids[0]}/group`, headers: s.h, payload: { groupId: eightU.id } });
    expect(down.statusCode).toBe(400);
    expect(down.json().error).toContain("only move up");
  });

  it("bumps a wrestler up an age group on regroup, with a flag", async () => {
    const s = await setup([60, 61, 62]);
    // Put a 2020-born (8U) kid in this event and bump him to 10U.
    const e = (await app.inject({
      method: "POST",
      url: `/api/events/${s.slug}/entries`,
      headers: s.h,
      payload: { firstName: "Up", lastName: "Kid", birthYear: 2020, gender: "boys" },
    })).json();
    await app.inject({ method: "PATCH", url: `/api/events/${s.slug}/entries/${e.id}`, headers: s.h, payload: { weight: 61.5, bumpAge: 1 } });
    await s.auto();
    const g = (await s.groups()).groups.find((x: { memberIds: string[] }) => x.memberIds.includes(e.id));
    expect(g.memberIds).toHaveLength(4);
    expect(g.flags).toContainEqual({ type: "wrestling-up-age", wrestlerId: e.id, from: "8U Boys", to: "10U Boys" });
  });

  it("scratching a wrestler removes them from their group", async () => {
    const s = await setup([60, 61, 62, 63]);
    await s.auto();
    await app.inject({ method: "PATCH", url: `/api/events/${s.slug}/entries/${s.ids[0]}`, headers: s.h, payload: { status: "scratched" } });
    const { groups } = await s.groups();
    expect(groups[0].memberIds).not.toContain(s.ids[0]);
  });
});
