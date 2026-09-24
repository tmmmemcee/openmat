import { type BoutEnding, type BoutEvent, type Corner, type Ruleset, boutState, clock as fmtClock, finalizeBout } from "@openmat/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { type Bout, type Wrestler, api } from "../../api";
import { mmss, useMatchClock } from "../../lib/clock";
import { useEventMutation } from "../../lib/hooks";
import { enqueue, flush, useOutbox } from "../../lib/outbox";
import { Button, Dialog, ErrorBox, Notice, Spinner, cx } from "../../ui";
import { penaltyButtons } from "./labels";

interface BoutDetail {
  bout: Bout;
  bracketName: string;
  wrestlers: (Wrestler & { divisionId: string })[];
  periodsSec: number[];
  rulesetId: string;
  events: (BoutEvent & { by: string; createdAt: string })[];
}

const CORNER_STYLE: Record<Corner, { bg: string; text: string; button: string }> = {
  A: { bg: "bg-red-600", text: "text-red-700", button: "bg-red-600 hover:bg-red-700 active:bg-red-800" },
  B: { bg: "bg-emerald-600", text: "text-emerald-700", button: "bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800" },
};

export function ScoreScreen({ slug, boutId, ruleset, mat, onDone }: { slug: string; boutId: string; ruleset: Ruleset; mat: number; onDone: () => void }) {
  const detail = useQuery({
    queryKey: ["bout", slug, boutId],
    queryFn: () => api<BoutDetail>(`/events/${slug}/bouts/${boutId}`, { slug }),
    refetchInterval: 10_000,
  });
  if (detail.isLoading) return <Spinner />;
  if (!detail.data) return <ErrorBox error={detail.error} />;
  return <Scoring slug={slug} detail={detail.data} ruleset={ruleset} mat={mat} onDone={onDone} />;
}

function Scoring({ slug, detail, ruleset, mat, onDone }: { slug: string; detail: BoutDetail; ruleset: Ruleset; mat: number; onDone: () => void }) {
  const { bout } = detail;
  const outbox = useOutbox(slug);
  const clock = useMatchClock(bout.id, detail.periodsSec);
  const [finishing, setFinishing] = useState(false);
  // Taps made on this screen. Kept so the score doesn't jump back between a tap
  // syncing (leaving the outbox) and the next refresh of the server log.
  const [local, setLocal] = useState<BoutEvent[]>([]);
  const pending = outbox.filter((o) => o.boutId === bout.id).map((o) => o.event as unknown as BoutEvent);
  // Server log, then this screen's taps, then anything still queued from before, without duplicates.
  const events = useMemo(() => {
    const seen = new Set<string>();
    return [...detail.events, ...local, ...pending].filter((e) => !seen.has(e.id) && (seen.add(e.id), true));
  }, [detail.events, local, pending]);
  const state = boutState(ruleset, events);
  const who = (c: Corner) => detail.wrestlers.find((w) => w.id === (c === "A" ? bout.a : bout.b));
  const add = (e: Record<string, unknown>) => {
    const item = enqueue(slug, bout.id, { ...e, period: clock.period, matchTimeSec: clock.matchTimeSec });
    setLocal((l) => [...l, item.event as unknown as BoutEvent]);
  };
  const voided = new Set(events.filter((e) => e.type === "void").map((e) => (e as { target: string }).target));
  const lastActive = [...events].reverse().find((e) => e.type !== "void" && !voided.has(e.id));

  const side = (c: Corner) => {
    const w = who(c);
    return (
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <div className={cx("rounded-2xl p-4 text-white", CORNER_STYLE[c].bg)}>
          <div className="text-xs font-bold tracking-wider uppercase opacity-80">{ruleset.cornerColors[c]}</div>
          <div className="truncate text-xl font-bold">{w ? `${w.firstName} ${w.lastName}` : "?"}</div>
          <div className="truncate text-sm opacity-80">{w?.team}</div>
          <div className="mt-1 text-6xl font-black tabular-nums">{state.score[c]}</div>
          {state.cautions[c] > 0 && <div className="text-sm">Cautions: {state.cautions[c]}</div>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {ruleset.actions.map((a) => (
            <button
              key={a.code}
              type="button"
              onClick={() => add({ type: "score", corner: c, action: a.code })}
              className={cx("rounded-xl px-2 py-3 text-left text-white shadow-sm transition", CORNER_STYLE[c].button)}
            >
              <span className="block text-lg leading-none font-black">+{a.points}</span>
              <span className="block truncate text-xs font-medium opacity-90">{a.label}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {penaltyButtons(ruleset).map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => add({ type: "penalty", corner: c, kind: p.kind, ...(p.points ? { points: p.points } : {}) })}
              className="rounded-lg bg-white px-2 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="bg-slate-900 px-4 py-2 text-white" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <button type="button" onClick={onDone} className="text-sm font-semibold text-amber-300">
            ← Mat {mat}
          </button>
          <div className="truncate text-sm">
            Bout {bout.boutNumber} · {detail.bracketName}
          </div>
          <span className={cx("rounded-full px-2 py-0.5 text-xs font-bold", pending.length ? "bg-amber-400 text-slate-900" : "bg-emerald-500")}>
            {pending.length ? `${pending.length} to sync` : "Synced"}
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-4">
        {/* Clock */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase">{clock.overtime ? `Overtime ${clock.period - detail.periodsSec.length}` : `Period ${clock.period}`}</div>
            <div className={cx("font-mono text-5xl font-black tabular-nums", clock.expired && "text-red-600")}>{mmss(clock.remaining)}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" variant={clock.running ? "secondary" : "primary"} onClick={clock.toggle} disabled={clock.expired}>
              {clock.running ? "Stop" : "Start"}
            </Button>
            <Button size="lg" variant="secondary" onClick={clock.nextPeriod} disabled={clock.running}>
              Next period
            </Button>
            <Button
              size="lg"
              variant="ghost"
              onClick={() => {
                const v = prompt("Time left in this period (m:ss)", mmss(clock.remaining));
                const m = v?.match(/^(\d{1,2}):(\d{2})$/);
                if (m) clock.setRemaining(Number(m[1]) * 60 + Number(m[2]));
              }}
            >
              Set
            </Button>
          </div>
        </div>

        {state.techFall && (
          <Notice tone="amber">
            {who(state.techFall.winner)?.firstName} leads by {ruleset.techFallMargin}+: technical fall. (High school: finish the near-fall first.)
          </Notice>
        )}
        {(state.disqualified || state.cautionedOut) && <Notice tone="red">{who((state.disqualified ?? state.cautionedOut)!)?.firstName} is disqualified by penalties. Finish the bout.</Notice>}
        {state.warnings.length > 0 && (
          <p className="text-sm text-slate-600">Warnings: {state.warnings.map((w) => `${who(w.corner)?.firstName} (${w.kind})`).join(", ")}</p>
        )}

        <div className="flex flex-col gap-4 md:flex-row">
          {side("A")}
          {side("B")}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="secondary" disabled={!lastActive} onClick={() => lastActive && add({ type: "void", target: lastActive.id, reason: "undo" })}>
            ↶ Undo last
          </Button>
          <Button size="lg" onClick={() => setFinishing(true)}>
            Finish bout
          </Button>
        </div>

        <ScoreLog events={events} ruleset={ruleset} names={{ A: who("A")?.firstName ?? "A", B: who("B")?.firstName ?? "B" }} voided={voided} />
      </div>

      {finishing && (
        <FinishDialog
          slug={slug}
          bout={bout}
          ruleset={ruleset}
          events={events}
          pending={pending.length}
          matchTimeSec={clock.matchTimeSec}
          names={{ A: who("A")?.firstName ?? "Red", B: who("B")?.firstName ?? "Green" }}
          onClose={() => setFinishing(false)}
          onFinished={() => {
            clock.reset();
            onDone();
          }}
        />
      )}
    </div>
  );
}

function ScoreLog({ events, ruleset, names, voided }: { events: BoutEvent[]; ruleset: Ruleset; names: Record<Corner, string>; voided: Set<string> }) {
  const rows = events.filter((e) => e.type !== "void").reverse();
  if (!rows.length) return <p className="text-center text-sm text-slate-400">Tap a button to score. Every tap is saved.</p>;
  return (
    <ol className="divide-y divide-slate-100 rounded-2xl bg-white text-sm shadow-sm ring-1 ring-slate-200">
      {rows.map((e) => {
        const label =
          e.type === "score"
            ? `${names[e.corner]}: ${ruleset.actions.find((a) => a.code === e.action)?.label ?? e.action}`
            : e.type === "penalty"
              ? `${names[e.corner]}: ${e.kind}${e.points ? ` (${e.points})` : ""}`
              : e.type === "riding-time"
                ? `Riding time: ${names[e.corner]} ${e.seconds}s`
                : "";
        return (
          <li key={e.id} className={cx("flex justify-between gap-3 px-4 py-2", voided.has(e.id) && "text-slate-400 line-through")}>
            <span>{label}</span>
            <span className="text-slate-400 tabular-nums">
              P{e.period ?? "?"} {e.matchTimeSec !== undefined ? fmtClock(e.matchTimeSec) : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function FinishDialog({
  slug,
  bout,
  ruleset,
  events,
  pending,
  matchTimeSec,
  names,
  onClose,
  onFinished,
}: {
  slug: string;
  bout: Bout;
  ruleset: Ruleset;
  events: BoutEvent[];
  pending: number;
  matchTimeSec: number;
  names: Record<Corner, string>;
  onClose: () => void;
  onFinished: () => void;
}) {
  const [ending, setEnding] = useState<BoutEnding>({ type: "time" });
  const preview = finalizeBout(ruleset, events, ending);
  const save = useEventMutation(slug, async () => {
    if (!(await flush(slug))) throw new Error("Can't reach the server to save. Your scoring is safe on this device; try again when you're back online.");
    return api(`/events/${slug}/bouts/${bout.id}/finish`, { method: "POST", slug, body: { mode: "live", ending } });
  });
  const pick = (e: BoutEnding) => setEnding(e);
  const endings: { label: string; value: BoutEnding }[] = [
    { label: "Time ran out", value: { type: "time" } },
    { label: "Tech fall", value: { type: "tech-fall" } },
    ...(["A", "B"] as Corner[]).flatMap((c) => [
      { label: `${names[c]} pinned`, value: { type: "fall" as const, winner: c, matchTimeSec } },
      { label: `${names[c]} by forfeit`, value: { type: "forfeit" as const, winner: c } },
      { label: `${names[c]} by injury default`, value: { type: "injury-default" as const, winner: c, matchTimeSec } },
      { label: `${names[c]} by DQ`, value: { type: "disqualification" as const, winner: c } },
    ]),
  ];
  return (
    <Dialog open onClose={onClose} title="Finish bout">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {endings.map((e) => (
            <button
              key={e.label}
              type="button"
              onClick={() => pick(e.value)}
              className={cx(
                "rounded-lg px-3 py-2.5 text-left text-sm font-semibold ring-2",
                JSON.stringify(e.value) === JSON.stringify(ending) ? "bg-brand-50 ring-brand-600" : "ring-slate-200",
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
        {preview.ok ? (
          <Notice tone="green">
            <strong>{names[preview.outcome.winner]}</strong> wins · {preview.outcome.summary}
          </Notice>
        ) : (
          <Notice tone="amber">{preview.message}</Notice>
        )}
        {pending > 0 && <p className="text-sm text-amber-700">{pending} taps still syncing; they'll be sent first.</p>}
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Keep scoring
          </Button>
          <Button disabled={!preview.ok || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onFinished })}>
            {save.isPending ? "Saving…" : "Save result"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
