import { type ChangeEvent, useMemo, useState } from "react";
import { type Entry, type EventInfo, api, uploadFile } from "../../api";
import { TEMPLATE_CSV, parseWrestlerCsv } from "../../lib/csv";
import { fullName, lbs } from "../../lib/format";
import { useEntries, useEventMutation } from "../../lib/hooks";
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, Notice, Select, Spinner } from "../../ui";
import { type EntryDraft, EntryForm } from "../EntryForm";

type Filter = "all" | "not-weighed" | "weighed-in" | "scratched" | "moved-up";

export default function Wrestlers({ event }: { event: EventInfo }) {
  const entries = useEntries(event.slug);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [divisionId, setDivisionId] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const divisionName = (id: string) => event.divisions.find((d) => d.id === id)?.name ?? "?";

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries.data ?? []).filter((e) => {
      if (q && !`${e.firstName} ${e.lastName} ${e.team}`.toLowerCase().includes(q)) return false;
      if (divisionId && e.divisionId !== divisionId) return false;
      if (filter === "not-weighed") return e.status === "registered";
      if (filter === "weighed-in") return e.status === "weighed-in";
      if (filter === "scratched") return e.status === "scratched";
      if (filter === "moved-up") return e.bumpAge > 0 || e.bumpWeight > 0;
      return true;
    });
  }, [entries.data, query, filter, divisionId]);

  if (entries.isLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search name or team" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select className="w-auto" value={divisionId} onChange={(e) => setDivisionId(e.target.value)}>
          <option value="">All divisions</option>
          {event.divisions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Select className="w-auto" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">Everyone</option>
          <option value="not-weighed">Not weighed in</option>
          <option value="weighed-in">Weighed in</option>
          <option value="moved-up">Moved up</option>
          <option value="scratched">Scratched</option>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => setImporting(true)}>
            Import spreadsheet
          </Button>
          <Button onClick={() => setAdding(true)}>+ Add wrestler</Button>
        </div>
      </div>

      <ErrorBox error={entries.error} />
      {entries.data?.length === 0 ? (
        <Card className="text-center">
          <p className="font-semibold">No wrestlers yet.</p>
          <p className="mt-1 text-sm text-slate-600">
            Add them one at a time, import a spreadsheet from coaches, or open registration so parents can sign up.
          </p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Team</th>
                <th className="px-4 py-2.5">Division</th>
                {event.format === "weight-classes" && <th className="px-4 py-2.5">Class</th>}
                <th className="px-4 py-2.5">Weight</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((e) => (
                <tr key={e.id} onClick={() => setEditing(e)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium">
                    <div className="flex items-center gap-2">
                      {e.photoUrl && e.photoConsent && (
                        <img
                          src={e.photoUrl}
                          alt=""
                          className="size-7 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                          loading="lazy"
                        />
                      )}
                      {fullName(e)}
                      {(e.bumpAge > 0 || e.bumpWeight > 0) && (
                        <span className="ml-1">
                          <Badge tone="blue">moved up</Badge>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{e.team}</td>
                  <td className="px-4 py-2.5 text-slate-600">{divisionName(e.divisionId)}</td>
                  {event.format === "weight-classes" && <td className="px-4 py-2.5">{e.weightClass ?? "—"}</td>}
                  <td className="px-4 py-2.5">{lbs(e.weight)}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge entry={e} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            Showing {list.length} of {entries.data?.length ?? 0}
          </p>
        </div>
      )}

      <AddDialog event={event} open={adding} onClose={() => setAdding(false)} />
      <ImportDialog event={event} open={importing} onClose={() => setImporting(false)} />
      {editing && <EditDialog event={event} entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function StatusBadge({ entry }: { entry: Entry }) {
  if (entry.status === "scratched") return <Badge tone="gray">Scratched</Badge>;
  if (entry.weighIn && entry.weighIn.status !== "ok") return <Badge tone="red">Check weight</Badge>;
  if (entry.status === "weighed-in") return <Badge tone="green">Weighed in</Badge>;
  return <Badge tone="amber">Not weighed</Badge>;
}

function AddDialog({ event, open, onClose }: { event: EventInfo; open: boolean; onClose: () => void }) {
  const [formKey, setFormKey] = useState(0);
  const [last, setLast] = useState<string | null>(null);
  const add = useEventMutation(event.slug, (draft: EntryDraft) =>
    api<Entry>(`/events/${event.slug}/entries`, { method: "POST", slug: event.slug, body: draft }),
  );
  return (
    <Dialog open={open} onClose={onClose} title="Add a wrestler">
      {last && <Notice tone="green">Added {last}. Add another, or close.</Notice>}
      <div className="mt-3">
        <EntryForm
          key={formKey}
          event={event}
          pending={add.isPending}
          error={add.error}
          onSubmit={(draft) =>
            add.mutate(draft, {
              onSuccess: () => {
                setLast(`${draft.firstName} ${draft.lastName}`);
                setFormKey((k) => k + 1);
              },
            })
          }
        />
      </div>
    </Dialog>
  );
}

function ImportDialog({ event, open, onClose }: { event: EventInfo; open: boolean; onClose: () => void }) {
  const [parsed, setParsed] = useState<Awaited<ReturnType<typeof parseWrestlerCsv>> | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const run = useEventMutation(event.slug, (rows: Record<string, unknown>[]) =>
    api<{ created: number; errors: { row: number; message: string }[] }>(`/events/${event.slug}/entries/import`, {
      method: "POST",
      slug: event.slug,
      body: { rows },
    }),
  );
  const template = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: "text/csv" }));
  const missing = parsed ? (["firstName", "lastName"] as const).filter((c) => !parsed.columns[c]) : [];

  return (
    <Dialog
      open={open}
      onClose={() => {
        setParsed(null);
        run.reset();
        onClose();
      }}
      title="Import from a spreadsheet"
    >
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">
          Save the spreadsheet as CSV (in Excel or Google Sheets: File → Download → CSV). We look for columns like first name, last name,
          team, birth year, gender{event.format === "weight-classes" ? ", weight class" : ""} and weight.{" "}
          <a href={template} download="openmat-wrestlers-template.csv" className="font-semibold text-brand-700 underline">
            Download a template
          </a>
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          className="block w-full text-sm"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            setParseError(null);
            run.reset();
            if (!file) return setParsed(null);
            try {
              setParsed(await parseWrestlerCsv(file));
            } catch {
              setParseError("We couldn't read that file. Make sure it's saved as CSV.");
            }
          }}
        />
        {parseError && <Notice tone="red">{parseError}</Notice>}
        {parsed && !run.data && (
          <>
            <Notice tone={missing.length ? "red" : "gray"}>
              {missing.length
                ? `Couldn't find a ${missing.map((m) => (m === "firstName" ? "first name" : "last name")).join(" or ")} column.`
                : `Found ${parsed.rows.length} wrestlers. Columns: ${Object.entries(parsed.columns)
                    .filter(([, v]) => v)
                    .map(([, v]) => v)
                    .join(", ")}.`}
            </Notice>
            <Button disabled={!!missing.length || run.isPending || !parsed.rows.length} onClick={() => run.mutate(parsed.rows)}>
              {run.isPending ? "Importing…" : `Import ${parsed.rows.length} wrestlers`}
            </Button>
          </>
        )}
        <ErrorBox error={run.error} />
        {run.data && (
          <div className="space-y-2">
            <Notice tone="green">Added {run.data.created} wrestlers.</Notice>
            {run.data.errors.length > 0 && (
              <Notice tone="amber">
                <p className="font-semibold">{run.data.errors.length} rows weren't added:</p>
                <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-5">
                  {run.data.errors.map((e) => (
                    <li key={e.row}>
                      Row {e.row + 1}: {e.message}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs">(Row numbers match the spreadsheet, counting the header as row 1.)</p>
              </Notice>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function EditDialog({ event, entry, onClose }: { event: EventInfo; entry: Entry; onClose: () => void }) {
  const [draft, setDraft] = useState({
    firstName: entry.firstName,
    lastName: entry.lastName,
    team: entry.team,
    birthYear: entry.birthYear,
    divisionId: entry.divisionId,
    weightClass: entry.weightClass,
    weight: entry.weight,
    seed: entry.seed,
    bumpAge: entry.bumpAge,
    bumpWeight: entry.bumpWeight,
    consent: entry.consent,
    notes: entry.notes,
    photoUrl: entry.photoUrl,
    photoConsent: entry.photoConsent,
    photoUploadedAt: entry.photoUploadedAt,
  });
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));
  const save = useEventMutation(event.slug, (body: object) =>
    api<Entry>(`/events/${event.slug}/entries/${entry.id}`, { method: "PATCH", slug: event.slug, body }),
  );
  const remove = useEventMutation(event.slug, () => api(`/events/${event.slug}/entries/${entry.id}`, { method: "DELETE", slug: event.slug }));

  // F15: photo upload + remove. Consent is set on upload (human gate).
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const onUploadPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const res = await uploadFile<{ ok: boolean; photoUrl: string | null; photoConsent: boolean; photoUploadedAt: string | null }>(
        `/events/${event.slug}/entries/${entry.id}/photo`,
        file,
        { slug: event.slug, fieldName: "file" },
      );
      setDraft((d) => ({
        ...d,
        photoUrl: res.photoUrl,
        photoConsent: res.photoConsent,
        photoUploadedAt: res.photoUploadedAt,
      }));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPhotoBusy(false);
      e.target.value = "";
    }
  };
  const onRemovePhoto = async () => {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await api(`/events/${event.slug}/entries/${entry.id}/photo`, { method: "DELETE", slug: event.slug });
      setDraft((d) => ({ ...d, photoUrl: null, photoConsent: false, photoUploadedAt: null }));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setPhotoBusy(false);
    }
  };

  const division = event.divisions.find((d) => d.id === draft.divisionId);
  const youth = event.format === "madison";
  const olderDivisions = event.divisions.filter(
    (d) => d.gender === division?.gender && d.maxAge !== null && division?.maxAge !== null && d.maxAge > (division?.maxAge ?? 0),
  );
  const movedUp = draft.bumpAge > 0 || draft.bumpWeight > 0;

  return (
    <Dialog open onClose={onClose} title={fullName(entry)}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          // Send only what changed, so e.g. the weigh-in time isn't reset by an unrelated edit.
          const PHOTO_FIELDS = new Set(["photoUrl", "photoConsent", "photoUploadedAt"]);
          const changed = Object.fromEntries(
            Object.entries(draft).filter(([k, v]) => !PHOTO_FIELDS.has(k) && entry[k as keyof Entry] !== v),
          );
          if (Object.keys(changed).length === 0) return onClose();
          save.mutate(changed, { onSuccess: onClose });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name">
            <Input value={draft.firstName} onChange={(e) => set({ firstName: e.target.value })} />
          </Field>
          <Field label="Last name">
            <Input value={draft.lastName} onChange={(e) => set({ lastName: e.target.value })} />
          </Field>
          <Field label="Team">
            <Input value={draft.team} onChange={(e) => set({ team: e.target.value })} />
          </Field>
          <Field label="Division">
            <Select value={draft.divisionId} onChange={(e) => set({ divisionId: e.target.value, weightClass: null })}>
              {event.divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          {youth ? (
            <Field label="Birth year">
              <Input
                type="number"
                value={draft.birthYear ?? ""}
                onChange={(e) => set({ birthYear: e.target.value ? Number(e.target.value) : null })}
              />
            </Field>
          ) : (
            <Field label="Weight class">
              <Select value={draft.weightClass ?? ""} onChange={(e) => set({ weightClass: e.target.value || null })}>
                <option value="">—</option>
                {division?.weightClasses?.map((w) => (
                  <option key={w} value={String(w)}>
                    {w}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Weigh-in weight (lb)">
            <Input
              type="number"
              step="0.1"
              inputMode="decimal"
              value={draft.weight ?? ""}
              onChange={(e) => set({ weight: e.target.value ? Number(e.target.value) : null })}
            />
          </Field>
        </div>

        <Field label="Seed" hint="Optional. Seed within their bracket (1 = best). Blank = drawn randomly.">
          <Input
            type="number"
            min={1}
            max={64}
            value={draft.seed ?? ""}
            onChange={(e) => set({ seed: e.target.value ? Number(e.target.value) : null })}
          />
        </Field>

        {/* F15: photo (consent-gated). Stored at /uploads/entries/<id>.<ext>. */}
        <Field
          label="Photo"
          hint="Optional. Shown on brackets and mat board only when the consent box is checked."
        >
          <div className="flex items-start gap-3">
            {draft.photoUrl ? (
              <img
                src={draft.photoUrl}
                alt=""
                className="size-16 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
              />
            ) : (
              <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400 ring-1 ring-slate-200">
                no photo
              </div>
            )}
            <div className="flex flex-1 flex-col gap-2">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="block w-full text-xs"
                disabled={photoBusy}
                onChange={onUploadPhoto}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={draft.photoConsent}
                  disabled={!draft.photoUrl || photoBusy}
                  onChange={(e) => set({ photoConsent: e.target.checked })}
                />
                Show on public results
              </label>
              {draft.photoUrl && (
                <button
                  type="button"
                  className="text-left text-xs text-red-700 underline disabled:opacity-50"
                  disabled={photoBusy}
                  onClick={onRemovePhoto}
                >
                  Remove photo
                </button>
              )}
            </div>
          </div>
          {photoError && <p className="mt-1 text-xs text-red-700">{photoError}</p>}
        </Field>
        {youth && (
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-sm font-semibold">Move up</p>
            <p className="text-xs text-slate-500">Wrestlers can move up an age group or weight group, never down. Regroup afterward.</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label="Age groups up">
                <Select value={draft.bumpAge} onChange={(e) => set({ bumpAge: Number(e.target.value) })}>
                  <option value={0}>None</option>
                  {olderDivisions.map((d, i) => (
                    <option key={d.id} value={i + 1}>
                      +{i + 1} ({d.name})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Weight groups up">
                <Select value={draft.bumpWeight} onChange={(e) => set({ bumpWeight: Number(e.target.value) })}>
                  {[0, 1, 2].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? "None" : `+${n}`}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {movedUp && (
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" checked={draft.consent} onChange={(e) => set({ consent: e.target.checked })} />
                Parent or coach agreed to the move
              </label>
            )}
          </div>
        )}

        <Field label="Notes">
          <Input value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        <ErrorBox error={save.error ?? remove.error} />
        <div className="flex flex-wrap justify-between gap-2 pt-2">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => save.mutate({ status: entry.status === "scratched" ? (entry.weight ? "weighed-in" : "registered") : "scratched" }, { onSuccess: onClose })}
            >
              {entry.status === "scratched" ? "Un-scratch" : "Scratch"}
            </Button>
            <Button
              variant="danger"
              onClick={() => confirm(`Delete ${fullName(entry)} from this tournament?`) && remove.mutate(undefined, { onSuccess: onClose })}
            >
              Delete
            </Button>
          </div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
