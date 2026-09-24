import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { type Templates, api } from "../api";
import { Button, Card, CopyButton, ErrorBox, Field, Header, Input, Notice, Page, Select, Spinner, cx } from "../ui";
import { setToken, staffUrl } from "../token";

type Kind = "youth" | "official";

interface DivisionDraft {
  name: string;
  ageDivision?: string;
  maxAge?: number;
  gender: "boys" | "girls" | "mixed";
  weightClasses?: number[];
  maxClassesUp?: number;
  periodsSec: number[];
}

const STEPS = ["Basics", "Type", "Divisions", "Mats & rules"];

/** Youth period lengths: 1-1-1 for the little ones, 1-1:30-1:30 from 12U up (USAW kids nationals style). */
const youthPeriods = (maxAge: number) => (maxAge <= 10 ? [60, 60, 60] : [60, 90, 90]);

const presetDivisionName = (preset: string) =>
  preset.replace("NFHS Boys (14)", "High School Boys").replace("NFHS Girls (14)", "High School Girls").replace("USAW Kids ", "");

export default function NewEvent() {
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => api<Templates>("/templates") });
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [location, setLocation] = useState("");
  const [kind, setKind] = useState<Kind>("youth");
  const [ages, setAges] = useState<string[]>(["8U", "10U", "12U", "14U"]);
  const [genders, setGenders] = useState<"separate" | "together">("separate");
  const [presets, setPresets] = useState<string[]>(["NFHS Boys (14)"]);
  const [rulesetId, setRulesetId] = useState<string>("");
  const [mats, setMats] = useState(4);
  const [restMin, setRestMin] = useState<number | null>(null);
  const [created, setCreated] = useState<{ slug: string; directorToken: string } | null>(null);
  const navigate = useNavigate();

  const t = templates.data;
  const defaultRuleset = kind === "youth" ? "usaw-kids-folkstyle-2025-26" : presets.some((p) => p.startsWith("NFHS")) ? "nfhs-2025-26" : "usaw-kids-folkstyle-2025-26";
  const ruleset = t?.rulesets.find((r) => r.id === (rulesetId || defaultRuleset));
  const rest = restMin ?? ruleset?.minRestMin ?? 30;

  const divisions = useMemo<DivisionDraft[]>(() => {
    if (!t) return [];
    if (kind === "youth") {
      const chosen = t.ageDivisions.filter((a) => ages.includes(a.name));
      const genderList = genders === "separate" ? (["boys", "girls"] as const) : (["mixed"] as const);
      return chosen.flatMap((a) =>
        genderList.map((g) => ({
          name: g === "mixed" ? a.name : `${a.name} ${g === "boys" ? "Boys" : "Girls"}`,
          ageDivision: a.name,
          maxAge: a.maxAge,
          gender: g,
          periodsSec: youthPeriods(a.maxAge),
        })),
      );
    }
    return t.weightClassPresets
      .filter((p) => presets.includes(p.name))
      .map((p) => ({
        name: presetDivisionName(p.name),
        gender: /girls/i.test(p.name) ? "girls" : "boys",
        weightClasses: p.limits,
        maxClassesUp: p.maxClassesUp,
        periodsSec: ruleset?.periodsSec ?? [120, 120, 120],
      }));
  }, [t, kind, ages, genders, presets, ruleset]);

  const create = useMutation({
    mutationFn: () =>
      api<{ slug: string; directorToken: string }>("/events", {
        method: "POST",
        body: {
          name,
          startDate,
          location,
          format: kind === "youth" ? "madison" : "weight-classes",
          rulesetId: ruleset!.id,
          settings: { mats, restMin: rest },
          divisions,
        },
      }),
    onSuccess: (res) => {
      setToken(res.slug, res.directorToken);
      setCreated(res);
    },
  });

  if (templates.isLoading) return <Spinner />;
  if (templates.error || !t) return <ErrorBox error={templates.error} />;

  if (created) {
    const link = staffUrl(created.slug, "manage", created.directorToken);
    return (
      <>
        <Header title="Your tournament is ready 🎉" />
        <Page className="max-w-2xl">
          <Card>
            <h2 className="text-lg font-bold">Save your director link</h2>
            <p className="mt-1 text-sm text-slate-600">
              This link is how you get back in to run <strong>{name}</strong>. There's no password: anyone with this link can manage the
              event, so keep it private. <strong>We can't show it again</strong>, so bookmark it or email it to yourself now.
            </p>
            <div className="mt-4 rounded-lg bg-slate-100 p-3 font-mono text-xs break-all">{link}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <CopyButton text={link} label="Copy link" />
              <a
                className="inline-flex items-center rounded-lg bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50"
                href={`mailto:?subject=${encodeURIComponent(`Director link: ${name}`)}&body=${encodeURIComponent(link)}`}
              >
                Email it to me
              </a>
            </div>
            <div className="mt-4">
              <Notice tone="gray">This browser is already signed in to the event, so you can keep going now.</Notice>
            </div>
            <Button size="lg" className="mt-5 w-full" onClick={() => navigate(`/e/${created.slug}/manage`)}>
              Go to my tournament →
            </Button>
          </Card>
        </Page>
      </>
    );
  }

  const canNext = [
    name.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(startDate),
    true,
    divisions.length > 0,
    mats >= 1 && !!ruleset,
  ][step];

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  return (
    <>
      <Header title="Set up a tournament" subtitle={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`} />
      <Page className="max-w-2xl">
        <ol className="mb-5 flex gap-2">
          {STEPS.map((s, i) => (
            <li key={s} className={cx("h-1.5 flex-1 rounded-full", i <= step ? "bg-brand-700" : "bg-slate-200")} aria-label={s} />
          ))}
        </ol>
        <Card>
          {step === 0 && (
            <div className="space-y-4">
              <Field label="Tournament name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Winter Kids Classic" autoFocus />
              </Field>
              <Field label="Date">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field label="Location" hint="Gym or school name and town. Optional.">
                <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Central High School, Springfield" />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">How will kids be put into brackets?</p>
              {(
                [
                  ["youth", "Youth: group by weight at weigh-ins", "No fixed weight classes. Kids of the same age group are put in small groups of similar weight (within about 10%). Most local youth tournaments do this."],
                  ["official", "Official weight classes", "Wrestlers enter a set weight class (106, 113, ... or kids classes). High school tournaments and kids qualifiers do this."],
                ] as const
              ).map(([value, title, text]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setKind(value)}
                  className={cx(
                    "block w-full rounded-lg p-4 text-left ring-2 transition",
                    kind === value ? "bg-brand-50 ring-brand-600" : "ring-slate-200 hover:ring-slate-300",
                  )}
                >
                  <div className="font-bold">{title}</div>
                  <div className="mt-1 text-sm text-slate-600">{text}</div>
                </button>
              ))}
            </div>
          )}

          {step === 2 && kind === "youth" && (
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Age groups</p>
                <div className="flex flex-wrap gap-2">
                  {t.ageDivisions.map((a) => (
                    <Chip key={a.name} on={ages.includes(a.name)} onClick={() => toggle(ages, setAges, a.name)}>
                      {a.name}
                    </Chip>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Ages follow USA Wrestling: a kid's age is the age they turn during the season. Kids can be moved up an age group later,
                  never down.
                </p>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">Boys and girls</p>
                <div className="flex flex-wrap gap-2">
                  <Chip on={genders === "separate"} onClick={() => setGenders("separate")}>
                    Separate divisions
                  </Chip>
                  <Chip on={genders === "together"} onClick={() => setGenders("together")}>
                    Together
                  </Chip>
                </div>
              </div>
              <DivisionPreview divisions={divisions} />
            </div>
          )}

          {step === 2 && kind === "official" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">Pick the weight class sets you'll use. You can adjust classes later.</p>
              <div className="space-y-2">
                {t.weightClassPresets.map((p) => (
                  <label key={p.name} className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      checked={presets.includes(p.name)}
                      onChange={() => toggle(presets, setPresets, p.name)}
                    />
                    <span>
                      <span className="font-semibold">{presetDivisionName(p.name)}</span>
                      <span className="block text-xs text-slate-500">{p.limits.join(", ")}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <Field label="How many mats?">
                <div className="flex items-center gap-3">
                  <Button variant="secondary" onClick={() => setMats(Math.max(1, mats - 1))} aria-label="Fewer mats">
                    −
                  </Button>
                  <span className="w-10 text-center text-2xl font-bold">{mats}</span>
                  <Button variant="secondary" onClick={() => setMats(Math.min(40, mats + 1))} aria-label="More mats">
                    +
                  </Button>
                </div>
              </Field>
              <Field label="Rules">
                <Select value={ruleset?.id} onChange={(e) => setRulesetId(e.target.value)}>
                  {t.rulesets.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.season})
                    </option>
                  ))}
                </Select>
              </Field>
              {ruleset && <p className="text-sm text-slate-600">{ruleset.summary}</p>}
              <Field label="Minimum rest between a wrestler's matches (minutes)" hint={`The ${ruleset?.name} default is ${ruleset?.minRestMin} minutes.`}>
                <Input type="number" min={0} max={120} value={rest} onChange={(e) => setRestMin(Number(e.target.value))} />
              </Field>
              <ErrorBox error={create.error} />
            </div>
          )}
        </Card>

        <div className="mt-4 flex justify-between gap-3">
          <Button variant="ghost" onClick={() => (step === 0 ? navigate("/") : setStep(step - 1))}>
            ← Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button disabled={!canNext} onClick={() => setStep(step + 1)}>
              Next →
            </Button>
          ) : (
            <Button disabled={!canNext || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Creating…" : "Create tournament"}
            </Button>
          )}
        </div>
      </Page>
    </>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "rounded-full px-4 py-2 text-sm font-semibold ring-1 transition",
        on ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

function DivisionPreview({ divisions }: { divisions: DivisionDraft[] }) {
  if (!divisions.length) return <Notice tone="amber">Pick at least one age group.</Notice>;
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700">Divisions ({divisions.length})</p>
      <div className="flex flex-wrap gap-1.5">
        {divisions.map((d) => (
          <span key={d.name} className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
            {d.name}
          </span>
        ))}
      </div>
    </div>
  );
}
