import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { type EventInfo, api } from "../api";
import { parseWrestlerCsv, parseWrestlerText } from "../lib/csv";
import { formatDate } from "../lib/format";
import { useEvent } from "../lib/hooks";
import { Button, Card, ErrorBox, Field, Header, Input, Notice, Page, Spinner, cx } from "../ui";

const MAX = 150;

interface Row {
  key: number;
  firstName: string;
  lastName: string;
  birthYear: string;
  gender: "" | "boys" | "girls";
  divisionId: string;
  weightClass: string;
  declaredWeight: string;
  /** Server's reason this row wasn't registered. */
  error?: string;
}

let nextKey = 1;
const blankRow = (): Row => ({ key: nextKey++, firstName: "", lastName: "", birthYear: "", gender: "", divisionId: "", weightClass: "", declaredWeight: "" });

function fromParsed(r: Record<string, unknown>): Row {
  return {
    ...blankRow(),
    firstName: String(r.firstName ?? ""),
    lastName: String(r.lastName ?? ""),
    birthYear: r.birthYear ? String(r.birthYear) : "",
    gender: (r.gender as Row["gender"]) ?? "",
    weightClass: r.weightClass ? String(r.weightClass) : "",
    declaredWeight: r.declaredWeight ? String(r.declaredWeight) : "",
  };
}

const isEmpty = (r: Row) => !r.firstName && !r.lastName && !r.birthYear && !r.weightClass && !r.declaredWeight;

/** What's missing from a row before we even send it. */
function missing(r: Row, event: EventInfo): string[] {
  const out: string[] = [];
  if (!r.firstName.trim()) out.push("first name");
  if (!r.lastName.trim()) out.push("last name");
  if (event.format === "madison") {
    if (!/^\d{4}$/.test(r.birthYear)) out.push("birth year");
    if (!r.gender && !event.divisions.some((d) => d.gender === "mixed")) out.push("boys/girls");
  } else {
    if (event.divisions.length > 1 && !r.divisionId && !r.gender) out.push("division");
    if (!r.weightClass) out.push("weight class");
  }
  return out;
}

/** Coaches register a whole roster at once: paste from a spreadsheet, upload a CSV, or type it in. */
export default function TeamRegister() {
  const { slug = "" } = useParams();
  const event = useEvent(slug);
  if (event.isLoading) return <Spinner />;
  if (!event.data)
    return (
      <Page>
        <ErrorBox error={event.error} />
      </Page>
    );
  return <RosterForm event={event.data} />;
}

function RosterForm({ event }: { event: EventInfo }) {
  const [team, setTeam] = useState("");
  const [email, setEmail] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [blankRow(), blankRow(), blankRow()]);
  const [paste, setPaste] = useState("");
  const [done, setDone] = useState<string[]>([]);
  const youth = event.format === "madison";
  const mixed = event.divisions.some((d) => d.gender === "mixed");
  const filled = rows.filter((r) => !isEmpty(r));
  const incomplete = filled.filter((r) => missing(r, event).length > 0);

  const submit = useMutation({
    mutationFn: (toSend: Row[]) =>
      api<{ created: number; errors: { row: number; message: string }[] }>(`/events/${event.slug}/entries/import`, {
        method: "POST",
        body: {
          team,
          contactEmail: email || null,
          rows: toSend.map((r) => ({
            firstName: r.firstName.trim(),
            lastName: r.lastName.trim(),
            ...(r.birthYear ? { birthYear: Number(r.birthYear) } : {}),
            ...(r.gender ? { gender: r.gender } : mixed ? { gender: "boys" } : {}),
            ...(r.divisionId ? { divisionId: r.divisionId } : {}),
            ...(r.weightClass ? { weightClass: r.weightClass } : {}),
            ...(r.declaredWeight ? { declaredWeight: Number(r.declaredWeight) } : {}),
          })),
        },
      }),
    onSuccess: (res, sent) => {
      const failed = new Map(res.errors.map((e) => [e.row - 1, e.message]));
      setDone((d) => [...d, ...sent.filter((_, i) => !failed.has(i)).map((r) => `${r.firstName} ${r.lastName}`)]);
      const keep = sent.flatMap((r, i) => (failed.has(i) ? [{ ...r, error: failed.get(i) }] : []));
      setRows(keep.length ? keep : [blankRow(), blankRow(), blankRow()]);
    },
  });

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, error: undefined } : r)));
  const addParsed = (parsed: Record<string, unknown>[]) => {
    const incoming = parsed.map(fromParsed).filter((r) => !isEmpty(r));
    setRows((rs) => [...rs.filter((r) => !isEmpty(r)), ...incoming].slice(0, MAX));
  };

  if (!event.settings.registrationOpen) {
    return (
      <>
        <Header title={event.name} subtitle="Team registration" />
        <Page className="max-w-xl">
          <Notice tone="amber">Registration for this tournament is closed.</Notice>
        </Page>
      </>
    );
  }

  const cell = "w-full rounded-md border-0 bg-white px-2 py-1.5 text-sm ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-600 focus:outline-none";
  return (
    <>
      <Header title={event.name} subtitle={`Register a team · ${formatDate(event.startDate)}`} />
      <Page className="space-y-4">
        <Link to={`/e/${event.slug}`} className="text-sm font-semibold text-brand-700">
          ← Tournament page
        </Link>
        {done.length > 0 && (
          <Notice tone="green">
            <strong>{done.length} registered:</strong> {done.join(", ")}.
          </Notice>
        )}

        <Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Team or club name" hint="Every wrestler below is registered with this team.">
              <Input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Springfield Youth Wrestling" />
            </Field>
            <Field label="Coach email" hint="Optional. For tournament updates only.">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="font-bold">Add your roster</h2>
          <p className="mt-1 text-sm text-slate-600">
            Copy the rows from your spreadsheet and paste them here, or upload a CSV file. Include a header row if you have one; otherwise use
            the order: first name, last name, birth year, boys/girls, weight. You can fix anything in the table below before sending.
          </p>
          <textarea
            className="mt-3 block h-28 w-full rounded-lg border-0 p-3 font-mono text-xs ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-600 focus:outline-none"
            placeholder={"First Name\tLast Name\tBirth Year\tGender\tWeight\nSam\tSmith\t2017\tBoys\t62"}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              disabled={!paste.trim()}
              onClick={() => {
                addParsed(parseWrestlerText(paste).rows);
                setPaste("");
              }}
            >
              Add pasted rows
            </Button>
            <label className="cursor-pointer text-sm font-semibold text-brand-700">
              Upload CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) addParsed((await parseWrestlerCsv(file)).rows);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </Card>

        <Card className="overflow-x-auto p-0 sm:p-0">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-2 py-2 pl-4">First name</th>
                <th className="px-2 py-2">Last name</th>
                {youth && <th className="w-28 px-2 py-2">Birth year</th>}
                {(youth ? !mixed : event.divisions.length > 1) && <th className="w-32 px-2 py-2">{youth ? "Boys/Girls" : "Division"}</th>}
                {!youth && <th className="w-28 px-2 py-2">Class</th>}
                <th className="w-24 px-2 py-2">Weight</th>
                <th className="w-10 px-2 py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const division = event.divisions.find((d) => d.id === r.divisionId) ?? (event.divisions.length === 1 ? event.divisions[0] : undefined);
                const gaps = isEmpty(r) ? [] : missing(r, event);
                return (
                  <tr key={r.key} className={cx("border-t border-slate-100 align-top", r.error && "bg-red-50")}>
                    <td className="px-2 py-1.5 pl-4">
                      <input className={cell} value={r.firstName} onChange={(e) => update(r.key, { firstName: e.target.value })} aria-label="First name" />
                      {(r.error || gaps.length > 0) && (
                        <p className={cx("mt-1 text-xs", r.error ? "font-medium text-red-700" : "text-amber-700")}>
                          {r.error ?? `Needs ${gaps.join(", ")}`}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <input className={cell} value={r.lastName} onChange={(e) => update(r.key, { lastName: e.target.value })} aria-label="Last name" />
                    </td>
                    {youth && (
                      <td className="px-2 py-1.5">
                        <input className={cell} inputMode="numeric" value={r.birthYear} onChange={(e) => update(r.key, { birthYear: e.target.value })} aria-label="Birth year" />
                      </td>
                    )}
                    {youth && !mixed && (
                      <td className="px-2 py-1.5">
                        <select className={cell} value={r.gender} onChange={(e) => update(r.key, { gender: e.target.value as Row["gender"] })} aria-label="Boys or girls">
                          <option value="">—</option>
                          <option value="boys">Boys</option>
                          <option value="girls">Girls</option>
                        </select>
                      </td>
                    )}
                    {!youth && event.divisions.length > 1 && (
                      <td className="px-2 py-1.5">
                        <select className={cell} value={r.divisionId} onChange={(e) => update(r.key, { divisionId: e.target.value })} aria-label="Division">
                          <option value="">—</option>
                          {event.divisions.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    {!youth && (
                      <td className="px-2 py-1.5">
                        <select className={cell} value={r.weightClass} onChange={(e) => update(r.key, { weightClass: e.target.value })} aria-label="Weight class">
                          <option value="">—</option>
                          {(division?.weightClasses ?? event.divisions.flatMap((d) => d.weightClasses ?? []))
                            .filter((w, i, all) => all.indexOf(w) === i)
                            .map((w) => (
                              <option key={w} value={String(w)}>
                                {w}
                              </option>
                            ))}
                        </select>
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      <input className={cell} inputMode="decimal" value={r.declaredWeight} onChange={(e) => update(r.key, { declaredWeight: e.target.value })} aria-label="Weight" />
                    </td>
                    <td className="px-2 py-1.5 pr-4">
                      <button type="button" className="rounded p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Remove row" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-slate-100 px-4 py-2">
            <button type="button" className="text-sm font-semibold text-brand-700" disabled={rows.length >= MAX} onClick={() => setRows((rs) => [...rs, blankRow()])}>
              + Add a row
            </button>
          </div>
        </Card>

        <ErrorBox error={submit.error} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          {incomplete.length > 0 && <span className="text-sm text-amber-700">
              {incomplete.length === 1 ? "1 row needs" : `${incomplete.length} rows need`} more info
            </span>}
          <Button size="lg" disabled={!team.trim() || filled.length === 0 || incomplete.length > 0 || submit.isPending} onClick={() => submit.mutate(filled)}>
            {submit.isPending ? "Registering…" : `Register ${filled.length} wrestler${filled.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </Page>
    </>
  );
}
