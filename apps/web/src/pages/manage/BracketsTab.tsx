import { useMemo, useState } from "react";
import { Link } from "react-router";
import { type Bracket, type EventInfo, type Wrestler, api } from "../../api";
import { BracketView } from "../../components/BracketView";
import { useBrackets, useEventMutation } from "../../lib/hooks";
import { Badge, Button, Card, Dialog, ErrorBox, Field, Notice, Select, Spinner } from "../../ui";

type GenerateResult = { created: number; skipped: { name: string; reason: string }[] };
type ScheduleResult = { scheduled: number; unscheduled: number; estimatedMinutes: number };

export default function BracketsTab({ event }: { event: EventInfo }) {
  const slug = event.slug;
  const data = useBrackets(slug);
  const [options, setOptions] = useState({ format: "auto", roundRobinUpTo: 5, places: 6, trueSecond: false });
  const [generated, setGenerated] = useState<GenerateResult | null>(null);
  const [scheduled, setScheduled] = useState<ScheduleResult | null>(null);
  const [viewing, setViewing] = useState<Bracket | null>(null);
  const [seeding, setSeeding] = useState<Bracket | null>(null);
  const wrestlers = useMemo(() => new Map((data.data?.wrestlers ?? []).map((w) => [w.id, w])), [data.data]);

  const generate = useEventMutation(slug, () => api<GenerateResult>(`/events/${slug}/brackets/generate`, { method: "POST", slug, body: options }));
  const schedule = useEventMutation(slug, () => api<ScheduleResult>(`/events/${slug}/brackets/schedule`, { method: "POST", slug, body: {} }));

  if (data.isLoading) return <Spinner />;
  const brackets = data.data?.brackets ?? [];
  const bouts = brackets.flatMap((b) => b.bouts).filter((b) => b.status !== "bye" && b.status !== "not-needed");
  const scheduledCount = bouts.filter((b) => b.mat).length;
  const started = bouts.some((b) => b.startedAt || b.winnerEntryId);
  const finish = Math.max(0, ...bouts.map((b) => (b.plannedStartMin ?? 0) + b.durationMin));

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-bold">1. Make brackets</h2>
        <p className="mt-1 text-sm text-slate-600">
          {event.format === "madison"
            ? "One bracket per group (from the Groups tab)."
            : "One bracket per weight class, for wrestlers who've weighed in."}{" "}
          Seeded wrestlers go on the top seed lines; everyone else is drawn randomly, keeping teammates apart.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field label="Format">
            <Select value={options.format} onChange={(e) => setOptions({ ...options, format: e.target.value })}>
              <option value="auto">Automatic</option>
              <option value="round-robin">Round robin</option>
              <option value="double-elim">Double elimination</option>
              <option value="single-elim">Single elimination</option>
            </Select>
          </Field>
          {options.format === "auto" && (
            <Field label="Round robin up to">
              <Select value={options.roundRobinUpTo} onChange={(e) => setOptions({ ...options, roundRobinUpTo: Number(e.target.value) })}>
                {[3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} wrestlers
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {options.format !== "round-robin" && options.format !== "single-elim" && (
            <>
              <Field label="Places">
                <Select value={options.places} onChange={(e) => setOptions({ ...options, places: Number(e.target.value) })}>
                  <option value={4}>1st–4th</option>
                  <option value={6}>1st–6th</option>
                  <option value={8}>1st–8th</option>
                </Select>
              </Field>
              <label className="flex items-end gap-2 pb-3 text-sm">
                <input type="checkbox" className="size-4" checked={options.trueSecond} onChange={(e) => setOptions({ ...options, trueSecond: e.target.checked })} />
                True second
              </label>
            </>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            disabled={generate.isPending || started}
            onClick={() => (!brackets.length || confirm("Replace all brackets? Seeds are kept; the draw is redone.")) && generate.mutate(undefined, { onSuccess: setGenerated })}
          >
            {brackets.length ? "Remake brackets" : "Make brackets"}
          </Button>
          {started && <span className="text-sm text-slate-500">Bouts have started, so brackets are locked. You can still redraw single brackets that haven't started.</span>}
        </div>
        <div className="mt-3 space-y-2">
          <ErrorBox error={generate.error} />
          {generated && (
            <Notice tone={generated.skipped.length ? "amber" : "green"}>
              Made {generated.created} brackets.
              {generated.skipped.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {generated.skipped.map((s) => (
                    <li key={s.name}>
                      {s.name}: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </Notice>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="font-bold">2. Mat schedule</h2>
        <p className="mt-1 text-sm text-slate-600">
          Puts every bout on a mat with a bout number, keeping {event.settings.restMin} minutes of rest between a wrestler's matches
          {event.format === "madison" ? " and each group on one mat" : ""}.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button disabled={!brackets.length || schedule.isPending || started} onClick={() => schedule.mutate(undefined, { onSuccess: setScheduled })}>
            {scheduledCount ? "Rebuild schedule" : "Build schedule"}
          </Button>
          {bouts.length > 0 && (
            <span className="text-sm text-slate-600">
              {scheduledCount}/{bouts.length} bouts on {event.settings.mats} mats
              {scheduledCount > 0 && <> · about {Math.floor(finish / 60)}h {Math.round(finish % 60)}m of wrestling</>}
            </span>
          )}
          {scheduledCount > 0 && (
            <>
              <Link to={`/e/${slug}/mats`} target="_blank" className="text-sm font-semibold text-brand-700">
                Mat board ↗
              </Link>
              <Link to={`/e/${slug}/print/bouts`} target="_blank" className="text-sm font-semibold text-brand-700">
                🖨 Bout sheets
              </Link>
            </>
          )}
          {brackets.length > 0 && (
            <Link to={`/e/${slug}/print/brackets`} target="_blank" className="text-sm font-semibold text-brand-700">
              🖨 Print brackets
            </Link>
          )}
        </div>
        <div className="mt-3">
          <ErrorBox error={schedule.error} />
          {scheduled && scheduled.unscheduled > 0 && <Notice tone="amber">{scheduled.unscheduled} bouts couldn't be scheduled.</Notice>}
        </div>
      </Card>

      {brackets.length > 0 && (
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5">Bracket</th>
                <th className="px-4 py-2.5">Format</th>
                <th className="px-4 py-2.5">Wrestlers</th>
                <th className="px-4 py-2.5">Progress</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {brackets.map((b) => {
                const real = b.bouts.filter((x) => x.status !== "bye" && x.status !== "not-needed");
                const done = real.filter((x) => x.status === "done").length;
                return (
                  <tr key={b.id}>
                    <td className="px-4 py-2.5 font-medium">{b.name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{b.format === "round-robin" ? "Round robin" : `${b.format === "double-elim" ? "Double" : "Single"} elim (${b.size})`}</td>
                    <td className="px-4 py-2.5">{b.draw.filter(Boolean).length}</td>
                    <td className="px-4 py-2.5">
                      {done === real.length && real.length ? <Badge tone="green">Done</Badge> : `${done}/${real.length} bouts`}
                      {b.bouts.some((x) => x.conflict) && (
                        <span className="ml-2">
                          <Badge tone="red">Check results</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {b.format !== "round-robin" && (
                        <Button variant="ghost" size="sm" onClick={() => setSeeding(b)}>
                          Seeds
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setViewing(b)}>
                        View
                      </Button>
                      <Link to={`/e/${slug}/print/brackets?b=${b.id}`} target="_blank" className="px-2 text-sm font-semibold text-slate-600" title="Print this bracket">
                        🖨
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name ?? ""}>
        {viewing && (
          <div className="max-h-[75vh] overflow-y-auto">
            <BracketView bracket={brackets.find((b) => b.id === viewing.id) ?? viewing} wrestlers={wrestlers} />
          </div>
        )}
      </Dialog>
      {seeding && <SeedDialog event={event} bracket={seeding} wrestlers={wrestlers} onClose={() => setSeeding(null)} />}
    </div>
  );
}

function SeedDialog({ event, bracket, wrestlers, onClose }: { event: EventInfo; bracket: Bracket; wrestlers: Map<string, Wrestler>; onClose: () => void }) {
  const ids = bracket.draw.filter((x): x is string => !!x);
  const [seeds, setSeeds] = useState<Record<string, number | null>>(() => Object.fromEntries(ids.map((id) => [id, wrestlers.get(id)?.seed ?? null])));
  const used = Object.values(seeds).filter((x): x is number => x !== null);
  const duplicate = used.find((s, i) => used.indexOf(s) !== i);
  const slug = event.slug;
  const save = useEventMutation(slug, async () => {
    for (const id of ids) {
      if ((wrestlers.get(id)?.seed ?? null) !== seeds[id]) {
        await api(`/events/${slug}/entries/${id}`, { method: "PATCH", slug, body: { seed: seeds[id] } });
      }
    }
    await api(`/events/${slug}/brackets/${bracket.id}/redraw`, { method: "POST", slug });
  });
  const sorted = [...ids].sort((a, b) => (seeds[a] ?? 99) - (seeds[b] ?? 99) || (wrestlers.get(a)?.lastName ?? "").localeCompare(wrestlers.get(b)?.lastName ?? ""));
  return (
    <Dialog open onClose={onClose} title={`Seeds: ${bracket.name}`}>
      <p className="mb-3 text-sm text-slate-600">
        Seed the best wrestlers. Seeds 1 and 2 can only meet in the final, 1–4 not before the semis. Unseeded wrestlers are drawn randomly. Saving redraws this
        bracket.
      </p>
      <ul className="max-h-[55vh] divide-y divide-slate-100 overflow-y-auto">
        {sorted.map((id) => {
          const w = wrestlers.get(id);
          return (
            <li key={id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <span className="font-medium">
                  {w?.firstName} {w?.lastName}
                </span>{" "}
                <span className="text-sm text-slate-500">{w?.team}</span>
              </span>
              <select
                className="rounded-md px-2 py-1 text-sm ring-1 ring-slate-300"
                value={seeds[id] ?? ""}
                aria-label={`Seed for ${w?.firstName} ${w?.lastName}`}
                onChange={(e) => setSeeds({ ...seeds, [id]: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">—</option>
                {ids.map((_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
      {duplicate && <Notice tone="red">Seed {duplicate} is used twice.</Notice>}
      <ErrorBox error={save.error} />
      <div className="mt-4 flex justify-end">
        <Button disabled={!!duplicate || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
          {save.isPending ? "Saving…" : "Save seeds and redraw"}
        </Button>
      </div>
    </Dialog>
  );
}
