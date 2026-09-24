import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { type Entry, type EventInfo, type WeighInCheck, api } from "../api";
import { fullName, lbs } from "../lib/format";
import { useEntries, useEvent, useEventMutation } from "../lib/hooks";
import { Button, Card, ErrorBox, Header, Input, Notice, Page, Spinner, cx } from "../ui";

/** Tablet-friendly weigh-in station: find the wrestler, type the weight, next. */
export default function WeighIn() {
  const { slug = "" } = useParams();
  const event = useEvent(slug);
  const role = event.data?.access?.role;
  const allowed = role === "director" || role === "weigh-in";
  const entries = useEntries(slug, allowed);

  if (event.isLoading) return <Spinner />;
  if (!event.data) return <ErrorBox error={event.error} />;
  if (!allowed) {
    return (
      <>
        <Header title={event.data.name} subtitle="Weigh-in" />
        <Page className="max-w-xl">
          <Notice tone="amber">Open the weigh-in link from the tournament director on this device.</Notice>
        </Page>
      </>
    );
  }
  const list = entries.data ?? [];
  const active = list.filter((e) => e.status !== "scratched");
  const done = active.filter((e) => e.weight !== null).length;
  return (
    <>
      <Header
        title={event.data.name}
        subtitle="Weigh-in station"
        right={
          <div className="text-right">
            <div className="text-2xl font-extrabold">
              {done}/{active.length}
            </div>
            <div className="text-xs text-brand-100">weighed in</div>
          </div>
        }
      />
      <Page className="max-w-3xl">{entries.isLoading ? <Spinner /> : <Station event={event.data} entries={list} />}</Page>
    </>
  );
}

function Station({ event, entries }: { event: EventInfo; entries: Entry[] }) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const divisionName = (id: string) => event.divisions.find((d) => d.id === id)?.name ?? "";

  const matches = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return entries
      .filter((e) => showAll || (e.weight === null && e.status !== "scratched"))
      .filter((e) => words.every((w) => `${e.firstName} ${e.lastName} ${e.team}`.toLowerCase().includes(w)))
      .slice(0, 30);
  }, [entries, query, showAll]);

  const finish = (id: string) => {
    setRecent((r) => [id, ...r.filter((x) => x !== id)].slice(0, 8));
    setSelectedId(null);
    setQuery("");
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  if (selected) {
    return <WeighCard key={selected.id} event={event} entry={selected} division={divisionName(selected.divisionId)} onDone={() => finish(selected.id)} onCancel={() => setSelectedId(null)} />;
  }

  return (
    <div className="space-y-4">
      <Input
        ref={searchRef}
        autoFocus
        className="py-4 text-xl sm:text-xl"
        placeholder="Type a name or team…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && matches.length === 1 && setSelectedId(matches[0]!.id)}
      />
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" className="size-4" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        Include wrestlers already weighed in or scratched
      </label>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        {matches.length === 0 && (
          <li className="px-4 py-6 text-center text-slate-500">{query ? "No match. Check spelling, or ask the director to add them." : "Everyone's weighed in! 🎉"}</li>
        )}
        {matches.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => setSelectedId(e.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-slate-50">
              <span>
                <span className="block text-lg font-semibold">{fullName(e)}</span>
                <span className="block text-sm text-slate-500">
                  {[e.team, divisionName(e.divisionId), e.weightClass && `${e.weightClass} class`].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="text-right text-sm text-slate-500">{e.status === "scratched" ? "Scratched" : e.weight !== null ? lbs(e.weight) : ""}</span>
            </button>
          </li>
        ))}
      </ul>
      {recent.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-500 uppercase">Just weighed</h2>
          <ul className="flex flex-wrap gap-2">
            {recent.map((id) => {
              const e = entries.find((x) => x.id === id);
              return e ? (
                <li key={id}>
                  <button type="button" onClick={() => setSelectedId(id)} className="rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-slate-200 hover:bg-slate-50">
                    {fullName(e)} · {e.status === "scratched" ? "scratched" : lbs(e.weight)}
                  </button>
                </li>
              ) : null;
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function WeighCard({ event, entry, division, onDone, onCancel }: { event: EventInfo; entry: Entry; division: string; onDone: () => void; onCancel: () => void }) {
  const [weight, setWeight] = useState(entry.weight?.toString() ?? "");
  const [check, setCheck] = useState<WeighInCheck | null>(null);
  const save = useEventMutation(event.slug, (body: object) =>
    api<Entry>(`/events/${event.slug}/entries/${entry.id}`, { method: "PATCH", slug: event.slug, body }),
  );
  const value = Number.parseFloat(weight);
  const valid = Number.isFinite(value) && value >= 20 && value <= 500;

  const submit = () =>
    save.mutate(
      { weight: value, ...(entry.status === "scratched" ? { status: "weighed-in" } : {}) },
      {
        onSuccess: (updated) => {
          if (updated.weighIn && updated.weighIn.status !== "ok") setCheck(updated.weighIn);
          else onDone();
        },
      },
    );

  return (
    <Card className="space-y-5">
      <div>
        <button type="button" onClick={onCancel} className="text-sm font-semibold text-brand-700">
          ← Back to list
        </button>
        <h2 className="mt-2 text-3xl font-extrabold">{fullName(entry)}</h2>
        <p className="text-slate-600">{[entry.team, division, entry.weightClass && `Entered at ${entry.weightClass}`].filter(Boolean).join(" · ")}</p>
      </div>

      {check ? (
        <WeightProblem check={check} onMove={(weightClass) => save.mutate({ weightClass }, { onSuccess: onDone })} onKeep={onDone} />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) submit();
          }}
          className="space-y-4"
        >
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Scale weight (lb)</span>
            <div className="mt-1 flex items-center gap-3">
              <Input
                autoFocus
                type="number"
                inputMode="decimal"
                step="0.1"
                className="py-4 text-4xl font-bold tabular-nums sm:text-4xl"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
              <span className="text-xl text-slate-500">lb</span>
            </div>
          </label>
          <ErrorBox error={save.error} />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" size="lg" disabled={!valid || save.isPending} className="flex-1">
              {save.isPending ? "Saving…" : "Save weight"}
            </Button>
            {entry.status !== "scratched" && (
              <Button
                size="lg"
                variant="secondary"
                onClick={() => confirm(`Scratch ${fullName(entry)}? (didn't show, sick, etc.)`) && save.mutate({ status: "scratched" }, { onSuccess: onDone })}
              >
                Scratch
              </Button>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}

function WeightProblem({ check, onMove, onKeep }: { check: WeighInCheck; onMove: (weightClass: string) => void; onKeep: () => void }) {
  const box = (tone: string, children: React.ReactNode) => <div className={cx("rounded-xl p-4 text-lg", tone)}>{children}</div>;
  switch (check.status) {
    case "missed-weight":
      return (
        <div className="space-y-3">
          {box("bg-red-50 text-red-900", <>Missed {check.declared.name} by {check.overBy} lb.</>)}
          <Button size="lg" className="w-full" onClick={() => onMove(check.suggested.name)}>
            Move to {check.suggested.name}
          </Button>
          <Button size="lg" variant="secondary" className="w-full" onClick={onKeep}>
            Leave it for the director
          </Button>
        </div>
      );
    case "too-far-up":
      return (
        <div className="space-y-3">
          {box(
            "bg-amber-50 text-amber-900",
            <>
              Weighs in for {check.natural.name}; can only go {check.maxClassesUp} class up, not {check.declared.name}.
            </>,
          )}
          <Button size="lg" className="w-full" onClick={() => onMove(check.natural.name)}>
            Move to {check.natural.name}
          </Button>
          <Button size="lg" variant="secondary" className="w-full" onClick={onKeep}>
            Leave it for the director
          </Button>
        </div>
      );
    case "over-max":
      return (
        <div className="space-y-3">
          {box("bg-red-50 text-red-900", <>Over the heaviest class ({check.heaviestLimit} lb). Tell the director.</>)}
          <Button size="lg" variant="secondary" className="w-full" onClick={onKeep}>
            OK
          </Button>
        </div>
      );
    default:
      return (
        <Button size="lg" className="w-full" onClick={onKeep}>
          OK
        </Button>
      );
  }
}
