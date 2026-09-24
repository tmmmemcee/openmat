import { useState } from "react";
import { type Division, type Entry, type EventInfo, type Group, type GroupFlag, api } from "../../api";
import { fullName, lbs } from "../../lib/format";
import { useEntries, useEventMutation, useGroups } from "../../lib/hooks";
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Notice, Spinner, cx } from "../../ui";

type AutoResult = { created: number; kept: number; unplaced: { entryId: string; message: string }[] };

export default function Groups({ event }: { event: EventInfo }) {
  const entries = useEntries(event.slug);
  const groups = useGroups(event.slug);
  const [autoResult, setAutoResult] = useState<AutoResult | null>(null);
  const [editingSettings, setEditingSettings] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const slug = event.slug;

  const auto = useEventMutation(slug, () => api<AutoResult>(`/events/${slug}/groups/auto`, { method: "POST", slug }));
  const move = useEventMutation(slug, ({ entryId, groupId }: { entryId: string; groupId: string | null }) =>
    api(`/events/${slug}/entries/${entryId}/group`, { method: "PUT", slug, body: { groupId } }),
  );
  const lock = useEventMutation(slug, ({ id, locked }: { id: string; locked: boolean }) =>
    api(`/events/${slug}/groups/${id}`, { method: "PATCH", slug, body: { locked } }),
  );
  const remove = useEventMutation(slug, (id: string) => api(`/events/${slug}/groups/${id}`, { method: "DELETE", slug }));
  const create = useEventMutation(slug, (divisionId: string) => api(`/events/${slug}/groups`, { method: "POST", slug, body: { divisionId } }));

  if (entries.isLoading || groups.isLoading) return <Spinner />;
  const byId = new Map((entries.data ?? []).map((e) => [e.id, e]));
  const allGroups = groups.data?.groups ?? [];
  const ungrouped = (groups.data?.ungroupedIds ?? []).map((id) => byId.get(id)).filter((e): e is Entry => !!e);
  const notWeighed = (entries.data ?? []).filter((e) => e.status === "registered").length;
  const flagged = allGroups.filter((g) => g.flags.some((f) => severity(f, byId) !== "info")).length;
  const g = event.settings.grouping;

  const drop = (groupId: string | null) => {
    if (dragging) move.mutate({ entryId: dragging, groupId });
    setDragging(null);
  };

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">Youth groups</h2>
            <p className="text-sm text-slate-600">
              Groups of {g.targetSize} ({g.minSize}–{g.maxSize}), everyone within {g.maxSpreadPct}%
              {g.spreadFloor > 0 ? ` (or ${g.spreadFloor} lb for the lightest kids)` : ""}.{" "}
              <button type="button" className="font-semibold text-brand-700 underline" onClick={() => setEditingSettings(true)}>
                Change
              </button>
            </p>
          </div>
          <Button
            disabled={auto.isPending}
            onClick={() => {
              if (allGroups.some((x) => !x.locked) && !confirm("Rebuild all groups that aren't locked? Locked groups stay as they are.")) return;
              auto.mutate(undefined, { onSuccess: setAutoResult });
            }}
          >
            {auto.isPending ? "Grouping…" : allGroups.length ? "Regroup" : "Group everyone automatically"}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Badge tone="gray">{allGroups.length} groups</Badge>
          {flagged > 0 && <Badge tone="red">{flagged} need a look</Badge>}
          {ungrouped.length > 0 && <Badge tone="amber">{ungrouped.length} not in a group</Badge>}
          {notWeighed > 0 && <Badge tone="amber">{notWeighed} not weighed in yet</Badge>}
        </div>
        <div className="mt-3 space-y-2">
          <ErrorBox error={auto.error ?? move.error ?? lock.error ?? remove.error ?? create.error} />
          {autoResult && (
            <Notice tone={autoResult.unplaced.length ? "amber" : "green"}>
              Made {autoResult.created} groups{autoResult.kept ? `, kept ${autoResult.kept} locked` : ""}.
              {autoResult.unplaced.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {autoResult.unplaced.map((u) => (
                    <li key={u.entryId}>{u.message}</li>
                  ))}
                </ul>
              )}
            </Notice>
          )}
          {allGroups.length === 0 && (
            <p className="text-sm text-slate-600">
              Weigh everyone in first, then group. Kids who haven't weighed in aren't grouped. You can drag kids between groups afterward,
              and lock groups you're happy with so regrouping leaves them alone.
            </p>
          )}
        </div>
      </Card>

      {ungrouped.length > 0 && (
        <DropZone onDrop={() => drop(null)} active={!!dragging}>
          <Card className="border-2 border-dashed border-amber-300 bg-amber-50/50">
            <h3 className="font-bold">Not in a group</h3>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {ungrouped.map((e) => (
                <MemberRow key={e.id} entry={e} event={event} groups={allGroups} onDrag={setDragging} onMove={(groupId) => move.mutate({ entryId: e.id, groupId })} />
              ))}
            </ul>
          </Card>
        </DropZone>
      )}

      {event.divisions.map((d) => {
        const list = allGroups.filter((x) => x.divisionId === d.id);
        if (!list.length && !allGroups.length) return null;
        return (
          <section key={d.id}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-lg font-bold">{d.name}</h3>
              <Button variant="ghost" size="sm" onClick={() => create.mutate(d.id)}>
                + New group
              </Button>
            </div>
            {list.length === 0 ? (
              <p className="text-sm text-slate-500">No groups.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((group) => (
                  <DropZone key={group.id} onDrop={() => drop(group.id)} active={!!dragging}>
                    <GroupCard
                      group={group}
                      division={d}
                      event={event}
                      byId={byId}
                      allGroups={allGroups}
                      onDrag={setDragging}
                      onMove={(entryId, groupId) => move.mutate({ entryId, groupId })}
                      onLock={() => lock.mutate({ id: group.id, locked: !group.locked })}
                      onDelete={() =>
                        (group.memberIds.length === 0 || confirm(`Remove Group ${group.number}? Its wrestlers become ungrouped.`)) &&
                        remove.mutate(group.id)
                      }
                    />
                  </DropZone>
                ))}
              </div>
            )}
          </section>
        );
      })}

      <SettingsDialog event={event} open={editingSettings} onClose={() => setEditingSettings(false)} />
    </div>
  );
}

function DropZone({ children, onDrop, active }: { children: React.ReactNode; onDrop: () => void; active: boolean }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (!active) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
      className={cx("rounded-xl transition", over && "ring-4 ring-brand-600/40")}
    >
      {children}
    </div>
  );
}

type Severity = "problem" | "warning" | "info";

function severity(f: GroupFlag, byId: Map<string, Entry>): Severity {
  if (f.type === "weight-spread" || f.type === "alone") return "problem";
  if (f.type === "undersized") return "warning";
  return byId.get(f.wrestlerId)?.consent ? "info" : "warning";
}

function flagText(f: GroupFlag, byId: Map<string, Entry>): string {
  const who = (id: string) => (byId.get(id) ? byId.get(id)!.firstName : "A wrestler");
  const consent = (id: string) => (byId.get(id)?.consent ? " ✓ agreed" : ", needs OK");
  switch (f.type) {
    case "weight-spread":
      return `${f.spreadPct}% apart (limit ${f.allowedPct}%)`;
    case "undersized":
      return `Only ${f.size} wrestlers`;
    case "alone":
      return "Alone: no matches";
    case "wrestling-up-age":
      return `${who(f.wrestlerId)} up from ${f.from}${consent(f.wrestlerId)}`;
    case "wrestling-up-weight":
      return `${who(f.wrestlerId)} up ${f.groupsUp} weight group${f.groupsUp > 1 ? "s" : ""}${consent(f.wrestlerId)}`;
  }
}

function GroupCard({
  group,
  division,
  event,
  byId,
  allGroups,
  onDrag,
  onMove,
  onLock,
  onDelete,
}: {
  group: Group;
  division: Division;
  event: EventInfo;
  byId: Map<string, Entry>;
  allGroups: Group[];
  onDrag: (id: string | null) => void;
  onMove: (entryId: string, groupId: string | null) => void;
  onLock: () => void;
  onDelete: () => void;
}) {
  const worst = group.flags.map((f) => severity(f, byId));
  const tone = worst.includes("problem") ? "ring-red-300" : worst.includes("warning") ? "ring-amber-300" : "ring-slate-200";
  return (
    <div className={cx("h-full rounded-xl bg-white p-4 shadow-sm ring-2", tone)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="font-bold">
            {division.name} · Group {group.number}
          </h4>
          <p className="text-sm text-slate-600">
            {group.memberIds.length ? `${lbs(group.minWeight)} – ${lbs(group.maxWeight)} · ${group.spreadPct}%` : "Empty"}
          </p>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onLock}
            title={group.locked ? "Locked: regrouping won't change this group" : "Lock this group"}
            className={cx("rounded p-1.5 text-sm", group.locked ? "bg-brand-100 text-brand-800" : "text-slate-400 hover:bg-slate-100")}
          >
            {group.locked ? "🔒" : "🔓"}
          </button>
          <button type="button" onClick={onDelete} title="Remove group" className="rounded p-1.5 text-sm text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>
      </div>
      {group.flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {group.flags.map((f, i) => {
            const s = severity(f, byId);
            return (
              <Badge key={i} tone={s === "problem" ? "red" : s === "warning" ? "amber" : "blue"}>
                {flagText(f, byId)}
              </Badge>
            );
          })}
        </div>
      )}
      <ul className="mt-3 space-y-1">
        {group.memberIds.map((id) => {
          const e = byId.get(id);
          return e ? (
            <MemberRow key={id} entry={e} event={event} groups={allGroups} currentGroupId={group.id} onDrag={onDrag} onMove={(to) => onMove(id, to)} />
          ) : null;
        })}
      </ul>
    </div>
  );
}

function MemberRow({
  entry,
  event,
  groups,
  currentGroupId,
  onDrag,
  onMove,
}: {
  entry: Entry;
  event: EventInfo;
  groups: Group[];
  currentGroupId?: string;
  onDrag: (id: string | null) => void;
  onMove: (groupId: string | null) => void;
}) {
  const native = event.divisions.find((d) => d.id === entry.divisionId);
  // Only groups in the same or an older division: never move down.
  const targets = groups.filter((g) => {
    const d = event.divisions.find((x) => x.id === g.divisionId);
    return d && (d.gender === native?.gender || d.gender === "mixed") && (d.maxAge ?? 0) >= (native?.maxAge ?? 0);
  });
  const divName = (id: string) => event.divisions.find((d) => d.id === id)?.name ?? "";
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDrag(entry.id);
      }}
      onDragEnd={() => onDrag(null)}
      className="flex cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 active:cursor-grabbing"
    >
      <span className="text-slate-300" aria-hidden>
        ⠿
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{fullName(entry)}</span>
        <span className="block truncate text-xs text-slate-500">{entry.team || "No team"}</span>
      </span>
      <span className="text-sm font-semibold tabular-nums">{lbs(entry.weight)}</span>
      <select
        aria-label={`Move ${fullName(entry)}`}
        className="w-20 shrink-0 rounded-md border-0 bg-white px-1.5 py-1 text-xs text-slate-600 ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-600 focus:outline-none"
        value=""
        onChange={(e) => onMove(e.target.value === "none" ? null : e.target.value)}
        title="Move to…"
      >
        <option value="">Move…</option>
        {currentGroupId && <option value="none">Not in a group</option>}
        {targets
          .filter((g) => g.id !== currentGroupId)
          .map((g) => (
            <option key={g.id} value={g.id}>
              {divName(g.divisionId)} · Group {g.number} ({g.memberIds.length ? `${g.minWeight}–${g.maxWeight}` : "empty"})
            </option>
          ))}
      </select>
    </li>
  );
}

function SettingsDialog({ event, open, onClose }: { event: EventInfo; open: boolean; onClose: () => void }) {
  const [g, setG] = useState(event.settings.grouping);
  const save = useEventMutation(event.slug, () =>
    api(`/events/${event.slug}`, { method: "PATCH", slug: event.slug, body: { settings: { grouping: g } } }),
  );
  const num = (key: keyof typeof g) => ({
    type: "number",
    value: g[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setG({ ...g, [key]: Number(e.target.value) }),
  });
  const valid = g.minSize <= g.targetSize && g.targetSize <= g.maxSize && g.minSize >= 1;
  return (
    <Dialog open={open} onClose={onClose} title="Grouping settings">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Smallest">
            <Input {...num("minSize")} min={1} max={8} />
          </Field>
          <Field label="Ideal size">
            <Input {...num("targetSize")} min={2} max={8} />
          </Field>
          <Field label="Largest">
            <Input {...num("maxSize")} min={2} max={16} />
          </Field>
        </div>
        <p className="text-xs text-slate-500">A group of 4 gives every kid 3 matches in a round robin.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max weight difference (%)" hint="Heaviest vs lightest in a group. 10% is common.">
            <Input {...num("maxSpreadPct")} min={0} max={50} step="0.5" />
          </Field>
          <Field label="Always allow (lb)" hint="Helps the lightest kids, where 10% is only a few pounds. 0 = off.">
            <Input {...num("spreadFloor")} min={0} max={30} step="0.5" />
          </Field>
        </div>
        {!valid && <Notice tone="red">Sizes must go smallest ≤ ideal ≤ largest.</Notice>}
        <ErrorBox error={save.error} />
        <div className="flex justify-end">
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
