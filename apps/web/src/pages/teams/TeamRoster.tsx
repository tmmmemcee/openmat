import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { ApiError, type EventInfo, type ExperienceLevel, type SavedWrestler, type Team, api } from "../../api";
import { parseWrestlerText } from "../../lib/csv";
import { formatDate, lbs } from "../../lib/format";
import { captureTeamToken, coachLink, getTeamToken } from "../../lib/teamToken";
import { Badge, Button, Card, CopyButton, Dialog, ErrorBox, Field, Header, Input, Notice, Page, Select, Spinner, cx } from "../../ui";

const LEVELS: { value: ExperienceLevel; label: string; hint: string }[] = [
  { value: "novice", label: "Novice", hint: "First season or two, still learning the basics" },
  { value: "intermediate", label: "Intermediate", hint: "Wins some, has a few moves they trust" },
  { value: "advanced", label: "Advanced", hint: "Places at tournaments, wrestles year-round" },
];
const levelLabel = (l: ExperienceLevel | null) => LEVELS.find((x) => x.value === l)?.label ?? "—";

function weightAge(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** A coach's saved roster, opened with the team's private coach link. */
export default function TeamRoster() {
  const { teamId = "" } = useParams();
  captureTeamToken(teamId);
  const token = getTeamToken(teamId);
  const team = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => api<Team>(`/teams/${teamId}`, { token }),
    enabled: !!token,
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
  });

  if (!token || (team.error instanceof ApiError && team.error.status === 401)) {
    return (
      <>
        <Header title="Team roster" />
        <Page className="max-w-xl space-y-3">
          <Notice tone="amber">
            This page needs your team's coach link. Open the link from the email you got when the team was saved, or ask another coach on
            your team to send it to you.
          </Notice>
          <Link to="/teams/new" className="text-sm font-semibold text-brand-700">
            New here? Save a team →
          </Link>
        </Page>
      </>
    );
  }
  if (team.isLoading) return <Spinner />;
  if (!team.data)
    return (
      <Page>
        <ErrorBox error={team.error} />
      </Page>
    );
  return <Roster team={team.data} token={token} />;
}

function Roster({ team, token }: { team: Team; token: string }) {
  const [editing, setEditing] = useState<SavedWrestler | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  return (
    <>
      <Header title={team.name} subtitle="Team roster · private to your coaches" />
      <Page className="space-y-4">
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            Bookmark this page. Share the coach link only with your other coaches: anyone who has it can change your roster.
          </p>
          <CopyButton text={coachLink(team.id, token)} label="Copy coach link" />
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">
            Wrestlers <span className="font-normal text-slate-500">({team.wrestlers.length})</span>
          </h2>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setImporting(true)}>
              Paste a roster
            </Button>
            <Button onClick={() => setEditing("new")}>+ Add wrestler</Button>
          </div>
        </div>

        {team.wrestlers.length === 0 ? (
          <Card className="text-center">
            <p className="font-semibold">No wrestlers yet.</p>
            <p className="mt-1 text-sm text-slate-600">Add them one at a time, or paste your roster from a spreadsheet.</p>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Born</th>
                  <th className="px-4 py-2.5">Latest weight</th>
                  <th className="px-4 py-2.5">Level</th>
                  <th className="px-4 py-2.5" title="Private matchmaking rating from results. Starts from the level.">
                    Rating
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {team.wrestlers.map((w) => (
                  <tr key={w.id} onClick={() => setEditing(w)} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium">
                      {w.firstName} {w.lastName}
                      {w.gender === "girls" && <span className="ml-2 text-xs text-slate-500">girl</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{w.birthYear ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {lbs(w.weight)}
                      {w.weightUpdatedAt && <span className="ml-2 text-xs text-slate-500">{weightAge(w.weightUpdatedAt)}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {levelLabel(w.level)}
                      {w.yearsWrestled != null && <span className="ml-1 text-xs text-slate-500">· {w.yearsWrestled} yr</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {w.rating}
                      <span className="ml-1 text-xs text-slate-500">
                        {w.ratedMatches === 0 ? "(from level)" : `(${w.ratedMatches} match${w.ratedMatches === 1 ? "" : "es"})`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-500">
          Level and rating are only used to make fair matchups. They're never shown on brackets, mat boards or to parents.
        </p>

        <RegisterCard team={team} token={token} />
      </Page>
      {editing && <WrestlerDialog team={team} token={token} wrestler={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ImportDialog team={team} token={token} open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

function useTeamMutation<V>(team: Team, fn: (v: V) => Promise<unknown>, onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["team", team.id] });
      onDone?.();
    },
  });
}

function WrestlerDialog({ team, token, wrestler, onClose }: { team: Team; token: string; wrestler: SavedWrestler | null; onClose: () => void }) {
  const [f, setF] = useState({
    firstName: wrestler?.firstName ?? "",
    lastName: wrestler?.lastName ?? "",
    birthYear: wrestler?.birthYear ? String(wrestler.birthYear) : "",
    gender: wrestler?.gender ?? "boys",
    weight: wrestler?.weight != null ? String(wrestler.weight) : "",
    level: wrestler?.level ?? "",
    yearsWrestled: wrestler?.yearsWrestled != null ? String(wrestler.yearsWrestled) : "",
    notes: wrestler?.notes ?? "",
  });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const body = {
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    birthYear: f.birthYear ? Number(f.birthYear) : null,
    gender: f.gender,
    // Only send the weight when it changed, so "weighed X days ago" stays true.
    ...(f.weight !== (wrestler?.weight != null ? String(wrestler.weight) : "") ? { weight: f.weight ? Number(f.weight) : null } : {}),
    level: f.level || null,
    yearsWrestled: f.yearsWrestled ? Number(f.yearsWrestled) : null,
    notes: f.notes,
  };
  const save = useTeamMutation(
    team,
    () =>
      wrestler
        ? api(`/teams/${team.id}/wrestlers/${wrestler.id}`, { method: "PATCH", body, token })
        : api(`/teams/${team.id}/wrestlers`, { method: "POST", body, token }),
    onClose,
  );
  const remove = useTeamMutation(team, () => api(`/teams/${team.id}/wrestlers/${wrestler!.id}`, { method: "DELETE", token }), onClose);
  const level = LEVELS.find((l) => l.value === f.level);

  return (
    <Dialog open onClose={onClose} title={wrestler ? `${wrestler.firstName} ${wrestler.lastName}` : "Add a wrestler"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name">
          <Input value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} />
        </Field>
        <Field label="Last name">
          <Input value={f.lastName} onChange={(e) => set({ lastName: e.target.value })} />
        </Field>
        <Field label="Birth year">
          <Input inputMode="numeric" value={f.birthYear} onChange={(e) => set({ birthYear: e.target.value })} placeholder="2017" />
        </Field>
        <Field label="Boys / Girls">
          <Select value={f.gender} onChange={(e) => set({ gender: e.target.value as "boys" | "girls" })}>
            <option value="boys">Boys</option>
            <option value="girls">Girls</option>
          </Select>
        </Field>
        <Field label="Latest weight (lbs)" hint={wrestler?.weightUpdatedAt ? `Last updated ${formatDate(wrestler.weightUpdatedAt)}` : "Updated automatically at weigh-ins"}>
          <Input inputMode="decimal" value={f.weight} onChange={(e) => set({ weight: e.target.value })} />
        </Field>
        <Field label="Years wrestling">
          <Input inputMode="numeric" value={f.yearsWrestled} onChange={(e) => set({ yearsWrestled: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Experience level" hint={level?.hint ?? "Helps make fair matchups before there are results to go on."}>
            <Select value={f.level} onChange={(e) => set({ level: e.target.value as ExperienceLevel | "" })}>
              <option value="">Not set</option>
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Coach notes" hint="Private to your coaches.">
            <Input value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>
      </div>
      {wrestler && wrestler.ratedMatches > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          Rating {wrestler.rating} from {wrestler.ratedMatches} rated match{wrestler.ratedMatches === 1 ? "" : "es"}. Changing the level no longer
          changes the rating; results do.
        </p>
      )}
      <div className="mt-4 space-y-2">
        <ErrorBox error={save.error ?? remove.error} />
        <div className="flex flex-wrap justify-between gap-2">
          {wrestler ? (
            <Button variant="danger" onClick={() => confirm(`Remove ${wrestler.firstName} from the roster?`) && remove.mutate(undefined)}>
              Remove from roster
            </Button>
          ) : (
            <span />
          )}
          <Button disabled={!f.firstName.trim() || !f.lastName.trim() || save.isPending} onClick={() => save.mutate(undefined)}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ImportDialog({ team, token, open, onClose }: { team: Team; token: string; open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);
  const parsed = text.trim() ? parseWrestlerText(text).rows.filter((r) => r.firstName || r.lastName) : [];
  const run = useTeamMutation(team, async () => {
    const res = await api<{ created: number; errors: { row: number; message: string }[] }>(`/teams/${team.id}/wrestlers/import`, {
      method: "POST",
      token,
      body: {
        rows: parsed.map((r) => ({
          firstName: String(r.firstName ?? "").trim(),
          lastName: String(r.lastName ?? "").trim(),
          ...(r.birthYear ? { birthYear: Number(r.birthYear) } : {}),
          ...(r.gender ? { gender: r.gender } : {}),
          ...(r.declaredWeight ? { weight: Number(r.declaredWeight) } : {}),
        })),
      },
    });
    setErrors(res.errors);
    if (!res.errors.length) {
      setText("");
      onClose();
    }
  });
  return (
    <Dialog open={open} onClose={onClose} title="Paste a roster">
      <p className="text-sm text-slate-600">
        Copy the rows from your spreadsheet and paste them here. Use a header row, or this order: first name, last name, birth year, boys/girls,
        weight. You can set experience levels afterwards.
      </p>
      <textarea
        className="mt-3 block h-40 w-full rounded-lg border-0 p-3 font-mono text-xs ring-1 ring-slate-300 focus:ring-2 focus:ring-brand-600 focus:outline-none"
        placeholder={"Sam\tSmith\t2017\tBoys\t62"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {errors.length > 0 && (
        <Notice tone="amber">
          Some rows weren't added:
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e) => (
              <li key={e.row}>
                Row {e.row}: {e.message}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      <ErrorBox error={run.error} />
      <div className="mt-3 flex justify-end">
        <Button disabled={!parsed.length || run.isPending} onClick={() => run.mutate(undefined)}>
          {run.isPending ? "Adding…" : `Add ${parsed.length} wrestler${parsed.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </Dialog>
  );
}

/** "https://…/e/winter-classic-x1y2" or just "winter-classic-x1y2" → the event slug. */
function slugFrom(input: string): string {
  const t = input.trim();
  const m = t.match(/\/e\/([\w-]+)/);
  return m ? m[1]! : t.replace(/[^\w-]/g, "");
}

function RegisterCard({ team, token }: { team: Team; token: string }) {
  const [link, setLink] = useState("");
  const slug = slugFrom(link);
  const event = useQuery({
    queryKey: ["event", slug],
    queryFn: () => api<EventInfo>(`/events/${slug}`),
    enabled: slug.length >= 3,
    retry: false,
  });
  return (
    <Card className="space-y-3">
      <h2 className="font-bold">Register for a tournament</h2>
      <Field label="Tournament link" hint="Paste the tournament's page address (or its code), then pick who's going.">
        <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://openmat-web.onrender.com/e/winter-classic" />
      </Field>
      {slug.length >= 3 && event.isLoading && <p className="text-sm text-slate-500">Looking it up…</p>}
      {slug.length >= 3 && event.error && <Notice tone="amber">Couldn't find that tournament. Check the link.</Notice>}
      {event.data && <PickWrestlers key={event.data.slug} team={team} token={token} event={event.data} />}
    </Card>
  );
}

interface Pick {
  on: boolean;
  weightClass: string;
  divisionId: string;
}

function PickWrestlers({ team, token, event }: { team: Team; token: string; event: EventInfo }) {
  const youth = event.format === "madison";
  const multiDiv = !youth && event.divisions.length > 1;
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [result, setResult] = useState<{ created: number; errors: { wrestlerId: string; name: string; message: string }[] } | null>(null);
  const pick = (id: string): Pick => picks[id] ?? { on: false, weightClass: "", divisionId: "" };
  const set = (id: string, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [id]: { ...pick(id), ...patch } }));
  const chosen = team.wrestlers.filter((w) => pick(w.id).on);
  const needsClass = !youth && chosen.some((w) => !pick(w.id).weightClass);
  const classes = (divisionId: string) =>
    (event.divisions.find((d) => d.id === divisionId) ?? (event.divisions.length === 1 ? event.divisions[0] : undefined))?.weightClasses ??
    [...new Set(event.divisions.flatMap((d) => d.weightClasses ?? []))];

  const submit = useMutation({
    mutationFn: () =>
      api<NonNullable<typeof result>>(`/teams/${team.id}/register`, {
        method: "POST",
        token,
        body: {
          eventSlug: event.slug,
          wrestlers: chosen.map((w) => ({
            wrestlerId: w.id,
            ...(pick(w.id).weightClass ? { weightClass: pick(w.id).weightClass } : {}),
            ...(pick(w.id).divisionId ? { divisionId: pick(w.id).divisionId } : {}),
          })),
        },
      }),
    onSuccess: (res) => {
      setResult(res);
      const failed = new Set(res.errors.map((e) => e.wrestlerId));
      setPicks((p) => Object.fromEntries(Object.entries(p).map(([id, x]) => [id, { ...x, on: failed.has(id) }])));
    },
  });

  return (
    <div className="space-y-3 border-t border-slate-100 pt-3">
      <p className="text-sm">
        <strong>{event.name}</strong> · {formatDate(event.startDate)}
        {event.location && ` · ${event.location}`}
      </p>
      {!event.settings.registrationOpen ? (
        <Notice tone="amber">Registration for this tournament is closed. Contact the tournament director.</Notice>
      ) : (
        <>
          {result && result.created > 0 && <Notice tone="green">{result.created} registered.</Notice>}
          {result && result.errors.length > 0 && (
            <Notice tone="amber">
              <ul className="list-disc pl-5">
                {result.errors.map((e) => (
                  <li key={e.wrestlerId}>
                    {e.name}: {e.message}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          <div className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
            {team.wrestlers.map((w) => {
              const p = pick(w.id);
              return (
                <div key={w.id} className={cx("flex flex-wrap items-center gap-3 px-3 py-2", p.on && "bg-brand-50")}>
                  <label className="flex min-w-48 flex-1 items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4" checked={p.on} onChange={(e) => set(w.id, { on: e.target.checked })} />
                    <span className="font-medium">
                      {w.firstName} {w.lastName}
                    </span>
                    <span className="text-xs text-slate-500">
                      {w.birthYear ?? ""} {w.weight != null && `· ${lbs(w.weight)}`}
                    </span>
                  </label>
                  {p.on && multiDiv && (
                    <select className="rounded-md px-2 py-1 text-sm ring-1 ring-slate-300" value={p.divisionId} onChange={(e) => set(w.id, { divisionId: e.target.value, weightClass: "" })} aria-label="Division">
                      <option value="">Division…</option>
                      {event.divisions.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {p.on && !youth && (
                    <select className="rounded-md px-2 py-1 text-sm ring-1 ring-slate-300" value={p.weightClass} onChange={(e) => set(w.id, { weightClass: e.target.value })} aria-label="Weight class">
                      <option value="">Class…</option>
                      {classes(p.divisionId).map((c) => (
                        <option key={c} value={String(c)}>
                          {c}
                        </option>
                      ))}
                    </select>
                  )}
                  {p.on && youth && !w.birthYear && <Badge tone="amber">needs birth year</Badge>}
                </div>
              );
            })}
          </div>
          <ErrorBox error={submit.error} />
          <div className="flex items-center justify-end gap-3">
            {needsClass && <span className="text-sm text-amber-700">Pick a weight class for everyone checked</span>}
            <Button disabled={!chosen.length || needsClass || submit.isPending} onClick={() => submit.mutate()}>
              {submit.isPending ? "Registering…" : `Register ${chosen.length} wrestler${chosen.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
