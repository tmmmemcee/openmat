import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { ApiError, type EventInfo, type ExperienceLevel, type MeetSettings, api } from "../../api";
import { lbs } from "../../lib/format";
import { useEventMutation } from "../../lib/hooks";
import { Badge, Button, Card, ErrorBox, Field, Notice, Select, Spinner, cx } from "../../ui";

interface MeetKid {
  id: string;
  name: string;
  team: string;
  weight: number | null;
  weightSource: "weigh-in" | "coach" | null;
  age: number | null;
  level: ExperienceLevel | null;
  rating: number | null;
  matches: number;
}

interface Pairing {
  boutId: string;
  round: number;
  a: string;
  b: string;
  status: "ready" | "wrestling" | "done";
  mat: number | null;
  boutNumber: string | null;
  weightPct?: number;
  ageGap?: number | null;
  flags: string[];
}

interface Board {
  options: MeetSettings & { similarSkill: number; skillWeightBonusPct: number; skillAgeBonus: number };
  pairings: Pairing[];
  wrestlers: MeetKid[];
  short: { entryId: string; matches: number; reason: string }[];
}

const LEVEL = { novice: "Nov", intermediate: "Int", advanced: "Adv" } as const;

function KidLine({ kid }: { kid: MeetKid | undefined }) {
  if (!kid) return <span className="text-slate-400">?</span>;
  return (
    <span>
      <span className="font-medium">{kid.name}</span> <span className="text-xs text-slate-500">{kid.team}</span>
      <span className="block text-xs text-slate-500">
        {lbs(kid.weight)}
        {kid.weightSource === "coach" && " (coach)"}
        {kid.age != null && ` · ${kid.age}y`}
        {kid.level && ` · ${LEVEL[kid.level]}`}
        {kid.rating != null && <span title="Private rating"> · {kid.rating}</span>}
      </span>
    </span>
  );
}

const kidOption = (k: MeetKid) =>
  `${k.name} · ${k.team} · ${k.weight != null ? `${k.weight} lb` : "no weight"}${k.age != null ? ` · ${k.age}y` : ""}${k.level ? ` · ${LEVEL[k.level]}` : ""} (${k.matches})`;

/** Director's pairing board for a scratch dual / tri-meet. */
export default function Pairings({ event }: { event: EventInfo }) {
  const slug = event.slug;
  const board = useQuery({ queryKey: ["pairings", slug], queryFn: () => api<Board>(`/events/${slug}/pairings`, { slug }) });
  const [result, setResult] = useState<string | null>(null);
  const auto = useEventMutation(slug, (replace: boolean) =>
    api<{ added: number; short: number }>(`/events/${slug}/pairings/auto`, { method: "POST", slug, body: { replace } }),
  );
  const remove = useEventMutation(slug, (boutId: string) => api(`/events/${slug}/pairings/${boutId}`, { method: "DELETE", slug }));

  if (board.isLoading) return <Spinner />;
  if (!board.data) return <ErrorBox error={board.error} />;
  const { pairings, wrestlers, short, options } = board.data;
  const kid = new Map(wrestlers.map((w) => [w.id, w]));
  const started = pairings.some((p) => p.status !== "ready");
  const rounds = [...new Set(pairings.map((p) => p.round))].sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      <SettingsCard event={event} options={options} />

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">Matches</h2>
            <p className="text-sm text-slate-600">
              {pairings.length} matches for {wrestlers.length} kids.{" "}
              {pairings.length > 0 && (
                <>
                  Next:{" "}
                  <Link to={`/e/${slug}/manage/brackets`} className="font-semibold text-brand-700">
                    build the mat schedule
                  </Link>
                  .
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {pairings.length > 0 && (
              <Button
                variant="secondary"
                disabled={auto.isPending}
                onClick={() =>
                  confirm(started ? "Redo every match that hasn't started? Matches already wrestled stay." : "Throw away all matches and pair everyone again?") &&
                  auto.mutate(true, { onSuccess: (r) => setResult(`Paired again: ${r.added} matches.`) })
                }
              >
                Start over
              </Button>
            )}
            <Button disabled={auto.isPending || !wrestlers.length} onClick={() => auto.mutate(false, { onSuccess: (r) => setResult(r.added ? `Added ${r.added} matches.` : "No more fair matches to add.") })}>
              {auto.isPending ? "Pairing…" : pairings.length ? "Fill in matches" : "Auto-pair"}
            </Button>
          </div>
        </div>
        <ErrorBox error={auto.error ?? remove.error} />
        {result && <Notice tone="green">{result}</Notice>}

        {short.length > 0 && (
          <Notice tone="amber">
            <strong>
              {short.length} kid{short.length === 1 ? "" : "s"} with fewer than {options.matchesPerKid} matches:
            </strong>
            <ul className="mt-1 space-y-0.5">
              {short.map((s) => (
                <li key={s.entryId}>
                  {kid.get(s.entryId)?.name} ({kid.get(s.entryId)?.team}): {s.matches} so far. {s.reason}
                </li>
              ))}
            </ul>
          </Notice>
        )}

        {rounds.map((round) => (
          <div key={round}>
            <h3 className="mt-2 mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Match {round}</h3>
            <div className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
              {pairings
                .filter((p) => p.round === round)
                .map((p) => (
                  <div key={p.boutId} className={cx("grid grid-cols-[1fr_auto_1fr_auto] items-center gap-3 px-3 py-2 text-sm", p.flags.length > 0 && "bg-amber-50/50")}>
                    <KidLine kid={kid.get(p.a)} />
                    <span className="text-center text-xs text-slate-500">
                      vs
                      {p.weightPct != null && <span className="block tabular-nums">{p.weightPct}%</span>}
                    </span>
                    <div>
                      <KidLine kid={kid.get(p.b)} />
                      {p.flags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {p.flags.map((f) => (
                            <Badge key={f} tone="amber">
                              {f}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right text-xs whitespace-nowrap text-slate-500">
                      {p.boutNumber && <span className="mr-2">#{p.boutNumber}</span>}
                      {p.status === "ready" ? (
                        <button type="button" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-700" aria-label="Remove match" onClick={() => remove.mutate(p.boutId)}>
                          ✕
                        </button>
                      ) : (
                        <Badge tone={p.status === "done" ? "green" : "blue"}>{p.status === "done" ? "Done" : "Live"}</Badge>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
        {!pairings.length && wrestlers.length > 0 && (
          <p className="text-sm text-slate-600">
            Press <strong>Auto-pair</strong> to give each kid up to {options.matchesPerKid} matches against the closest kids on other teams. Then remove or add
            matches by hand.
          </p>
        )}
        {!wrestlers.length && (
          <p className="text-sm text-slate-600">
            No kids yet. Coaches can register from their saved team roster, or you can add them on the Wrestlers tab.
          </p>
        )}
      </Card>

      <HandPair event={event} kids={wrestlers} />
    </div>
  );
}

function SettingsCard({ event, options }: { event: EventInfo; options: Board["options"] }) {
  const slug = event.slug;
  const [draft, setDraft] = useState<MeetSettings | null>(null);
  const save = useEventMutation(slug, (meet: MeetSettings) => api(`/events/${slug}`, { method: "PATCH", slug, body: { settings: { meet } } }));
  const v = draft ?? options;
  const set = (patch: Partial<MeetSettings>) => setDraft({ ...v, ...patch });
  return (
    <Card>
      <h2 className="font-bold">Pairing rules</h2>
      <p className="mt-1 text-sm text-slate-600">
        Kids only wrestle kids from other teams. When two kids' experience matches, up to {options.skillWeightBonusPct}% more weight difference and{" "}
        {options.skillAgeBonus} more year are allowed. Experience comes from coaches' saved rosters and is never shown publicly.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <Field label="Matches per kid">
          <Select value={v.matchesPerKid} onChange={(e) => set({ matchesPerKid: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </Select>
        </Field>
        <Field label="Max weight difference">
          <Select value={v.maxWeightPct} onChange={(e) => set({ maxWeightPct: Number(e.target.value) })}>
            {[5, 8, 10, 12, 15, 20].map((n) => (
              <option key={n} value={n}>
                {n}%
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Max age difference">
          <Select value={v.maxAgeGap} onChange={(e) => set({ maxAgeGap: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} year{n === 1 ? "" : "s"}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-end gap-2 pb-3 text-sm">
          <input type="checkbox" className="size-4" checked={!!v.mixGenders} onChange={(e) => set({ mixGenders: e.target.checked })} />
          Girls can wrestle boys
        </label>
      </div>
      {draft && (
        <div className="mt-2 flex items-center gap-3">
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(draft, { onSuccess: () => setDraft(null) })}>
            Save rules
          </Button>
          <span className="text-xs text-slate-500">Existing matches stay; "Fill in" or "Start over" uses the new rules.</span>
        </div>
      )}
      <ErrorBox error={save.error} />
    </Card>
  );
}

function HandPair({ event, kids }: { event: EventInfo; kids: MeetKid[] }) {
  const slug = event.slug;
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const sorted = [...kids].sort((x, y) => (x.weight ?? 999) - (y.weight ?? 999));
  const pair = useEventMutation(slug, (force: boolean) => api(`/events/${slug}/pairings`, { method: "POST", slug, body: { a, b, force } }));
  const submit = (force: boolean) =>
    pair.mutate(force, {
      onSuccess: () => {
        setA("");
        setB("");
        setWarning(null);
      },
      onError: (err) => setWarning(err instanceof ApiError && err.status === 409 && err.message.endsWith("anyway?") ? err.message : null),
    });
  const chosenA = kids.find((k) => k.id === a);
  // Closest weights on other teams first.
  const others = chosenA?.weight != null ? [...kids].filter((k) => k.id !== a).sort((x, y) => Math.abs((x.weight ?? 999) - chosenA.weight!) - Math.abs((y.weight ?? 999) - chosenA.weight!)) : sorted;
  return (
    <Card className="space-y-3">
      <h2 className="font-bold">Pair two kids by hand</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Field label="Wrestler">
          <Select value={a} onChange={(e) => (setA(e.target.value), setWarning(null))}>
            <option value="">Pick…</option>
            {sorted.map((k) => (
              <option key={k.id} value={k.id}>
                {kidOption(k)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Opponent" hint={chosenA ? "Closest weights first" : undefined}>
          <Select value={b} onChange={(e) => (setB(e.target.value), setWarning(null))} disabled={!a}>
            <option value="">Pick…</option>
            {others.map((k) => (
              <option key={k.id} value={k.id}>
                {kidOption(k)}
                {chosenA && k.team === chosenA.team ? " · teammate" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end pb-0.5">
          <Button disabled={!a || !b || pair.isPending} onClick={() => submit(false)}>
            Pair
          </Button>
        </div>
      </div>
      {warning ? (
        <Notice tone="amber">
          {warning}{" "}
          <Button size="sm" variant="secondary" onClick={() => submit(true)}>
            Yes, pair them
          </Button>
        </Notice>
      ) : (
        <ErrorBox error={pair.error} />
      )}
    </Card>
  );
}
