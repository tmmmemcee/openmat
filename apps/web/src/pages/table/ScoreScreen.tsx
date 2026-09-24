import {
  type BoutEnding,
  type BoutEvent,
  type BoutPosition,
  type BoutState,
  type Corner,
  type PeriodChoice,
  type Ruleset,
  allowedActions,
  boutState,
  clock as fmtClock,
  finalizeBout,
  positionFromChoice,
  positionOf,
} from "@openmat/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Bout, type Wrestler, api } from "../../api";
import { mmss, useMatchClock } from "../../lib/clock";
import { useEventMutation } from "../../lib/hooks";
import { enqueue, flush, useOutbox } from "../../lib/outbox";
import { useRidingClock } from "../../lib/riding";
import { Button, Dialog, ErrorBox, Notice, Spinner, cx } from "../../ui";
import { cap, penaltyButtons } from "./labels";

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
  // Position (folkstyle): periods 2+ start with a choice; the first overtime period starts neutral.
  const tracks = !!ruleset.tracksPosition;
  const firstOvertime = clock.period === detail.periodsSec.length + 1;
  const needsChoice = tracks && clock.period >= 2 && !firstOvertime && !state.positionPeriods.includes(clock.period);
  useEffect(() => {
    if (tracks && firstOvertime && !state.positionPeriods.includes(clock.period)) {
      add({ type: "position", position: "neutral", reason: "Sudden victory starts neutral" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, firstOvertime, clock.period]);
  // Who chose last time, to suggest the other wrestler this time.
  const lastChooser = [...events]
    .reverse()
    .find((e): e is Extract<BoutEvent, { type: "position" }> => e.type === "position" && !!e.chooser && !voidedIds(events).has(e.id))?.chooser;

  // Tech fall: stop the clock and ask, once per score.
  const scoreSig = `${state.score.A}-${state.score.B}`;
  const techFallNow = Math.abs(state.score.A - state.score.B) >= ruleset.techFallMargin;
  const [techFallDismissed, setTechFallDismissed] = useState<string | null>(null);
  const askTechFall = techFallNow && techFallDismissed !== scoreSig && !finishing;
  useEffect(() => {
    if (techFallNow && techFallDismissed !== scoreSig) clock.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techFallNow, scoreSig]);
  const [finishWith, setFinishWith] = useState<BoutEnding>({ type: "time" });

  // Share the match clock with live views (mat board) when it starts, stops, changes period or is corrected.
  const stoppedAt = clock.running ? -1 : Math.round(clock.remaining);
  useEffect(() => {
    void api(`/events/${slug}/bouts/${bout.id}/clock`, {
      method: "POST",
      slug,
      body: { period: clock.period, remainingSec: Math.round(clock.remaining), running: clock.running },
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock.running, clock.period, stoppedAt]);

  const riding = useRidingClock(bout.id, clock.running);
  const tracksRiding = !!ruleset.ridingTimePointSec;
  // Record the net riding advantage when the rider changes or the clock stops.
  const lastRiding = useRef<string>("");
  const saveRiding = () => {
    if (!tracksRiding) return;
    const { corner, seconds } = riding.advantage;
    const sig = `${corner}:${seconds}`;
    if (sig === lastRiding.current || (seconds === 0 && !lastRiding.current)) return;
    lastRiding.current = sig;
    add({ type: "riding-time", corner, seconds });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(saveRiding, [clock.running, riding.rider]);
  // The wrestler on top is riding.
  useEffect(() => {
    if (tracksRiding && tracks) riding.setRider(state.position === "neutral" ? null : (state.position[0] as Corner));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.position]);
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
          <div className="mt-1 flex items-end justify-between gap-2">
            <span className="text-6xl font-black tabular-nums">{state.score[c]}</span>
            {tracks && <span className="rounded-full bg-white/20 px-2.5 py-1 text-sm font-bold">{POSITION_LABEL[positionOf(state.position, c)]}</span>}
          </div>
          {state.cautions[c] > 0 && <div className="text-sm">Cautions: {state.cautions[c]}</div>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {needsChoice && <p className="col-span-2 rounded-xl bg-white p-3 text-sm text-slate-500 ring-1 ring-slate-200">Record the period choice above to score.</p>}
          {!needsChoice && allowedActions(ruleset, state, c).map((a) => (
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

        {tracksRiding && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase">Riding time</div>
              <div className="font-mono text-2xl font-black tabular-nums">
                {riding.advantage.seconds === 0 ? "0:00" : `${cap(ruleset.cornerColors[riding.advantage.corner])} +${mmss(riding.advantage.seconds)}`}
              </div>
              <div className="text-xs text-slate-500">
                {riding.advantage.seconds >= ruleset.ridingTimePointSec! ? "Worth 1 point at the end" : `1 point at ${mmss(ruleset.ridingTimePointSec!)}`}
              </div>
            </div>
            <div className="flex gap-2">
              {(["A", null, "B"] as (Corner | null)[]).map((c) => (
                <button
                  key={c ?? "none"}
                  type="button"
                  onClick={() => riding.setRider(c)}
                  className={cx(
                    "rounded-lg px-3 py-2 text-sm font-bold ring-2",
                    riding.rider === c
                      ? c === "A"
                        ? "bg-red-600 text-white ring-red-600"
                        : c === "B"
                          ? "bg-emerald-600 text-white ring-emerald-600"
                          : "bg-slate-700 text-white ring-slate-700"
                      : "ring-slate-200",
                  )}
                >
                  {c ? `${cap(ruleset.cornerColors[c])} on top` : "Neutral"}
                </button>
              ))}
            </div>
          </div>
        )}

        {tracks && (
          <PositionPanel
            ruleset={ruleset}
            state={state}
            period={clock.period}
            overtime={clock.overtime}
            needsChoice={needsChoice}
            suggested={lastChooser ? (lastChooser === "A" ? "B" : "A") : undefined}
            names={{ A: who("A")?.firstName ?? "Red", B: who("B")?.firstName ?? "Green" }}
            onSet={(e) => add(e)}
          />
        )}
        {state.outOfPosition.length > 0 && (
          <Notice tone="amber">Some scores don't fit the position (marked ⚠ below), for example two takedowns in a row. Undo or fix them if they were mistakes.</Notice>
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
          <Button
            size="lg"
            onClick={() => {
              saveRiding();
              setFinishWith(techFallNow ? { type: "tech-fall" } : { type: "time" });
              setFinishing(true);
            }}
          >
            Finish bout
          </Button>
        </div>

        <ScoreLog events={events} ruleset={ruleset} names={{ A: who("A")?.firstName ?? "A", B: who("B")?.firstName ?? "B" }} voided={voided} outOfPosition={new Set(state.outOfPosition)} />
      </div>

      {askTechFall && (
        <Dialog open onClose={() => setTechFallDismissed(scoreSig)} title="Technical fall">
          <div className="space-y-4">
            <p className="text-lg">
              <strong>{who(state.score.A > state.score.B ? "A" : "B")?.firstName}</strong> leads {Math.max(state.score.A, state.score.B)}–
              {Math.min(state.score.A, state.score.B)}, a {Math.abs(state.score.A - state.score.B)}-point lead. The clock is stopped.
            </p>
            {tracks && (
              <p className="text-sm text-slate-600">
                If the lead came from a takedown or reversal straight into a near fall, keep wrestling until the near fall ends, then finish.
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setTechFallDismissed(scoreSig)}>
                Keep wrestling
              </Button>
              <Button
                onClick={() => {
                  saveRiding();
                  setFinishWith({ type: "tech-fall" });
                  setTechFallDismissed(scoreSig);
                  setFinishing(true);
                }}
              >
                End match: tech fall
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {finishing && (
        <FinishDialog
          slug={slug}
          bout={bout}
          ruleset={ruleset}
          events={events}
          pending={pending.length}
          initialEnding={finishWith}
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

function ScoreLog({
  events,
  ruleset,
  names,
  voided,
  outOfPosition,
}: {
  events: BoutEvent[];
  ruleset: Ruleset;
  names: Record<Corner, string>;
  voided: Set<string>;
  outOfPosition: Set<string>;
}) {
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
                : e.type === "position"
                  ? e.chooser && e.choice
                    ? `${names[e.chooser]} chose ${e.choice}`
                    : `Position: ${e.position === "neutral" ? "neutral" : `${names[e.position[0] as Corner]} on top`}`
                  : "";
        return (
          <li key={e.id} className={cx("flex justify-between gap-3 px-4 py-2", voided.has(e.id) && "text-slate-400 line-through")}>
            <span>
              {outOfPosition.has(e.id) && !voided.has(e.id) && <span title="Doesn't fit the position">⚠ </span>}
              {label}
            </span>
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
  initialEnding,
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
  initialEnding: BoutEnding;
  matchTimeSec: number;
  names: Record<Corner, string>;
  onClose: () => void;
  onFinished: () => void;
}) {
  const [ending, setEnding] = useState<BoutEnding>(initialEnding);
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

const POSITION_LABEL = { neutral: "Neutral", top: "On top", bottom: "Bottom" } as const;

function voidedIds(events: BoutEvent[]): Set<string> {
  return new Set(events.filter((e) => e.type === "void").map((e) => (e as { target: string }).target));
}

/**
 * Folkstyle position: shows neutral / who's on top, records the choice at
 * the start of a period (with defer), and lets the table correct it.
 */
function PositionPanel({
  ruleset,
  state,
  period,
  overtime,
  needsChoice,
  suggested,
  names,
  onSet,
}: {
  ruleset: Ruleset;
  state: BoutState;
  period: number;
  overtime: boolean;
  needsChoice: boolean;
  suggested?: Corner;
  names: Record<Corner, string>;
  onSet: (e: Record<string, unknown>) => void;
}) {
  const [chooser, setChooser] = useState<Corner | null>(null);
  const [deferred, setDeferred] = useState<Corner | null>(null);
  useEffect(() => {
    setChooser(null);
    setDeferred(null);
  }, [period]);
  const color = (c: Corner) => cap(ruleset.cornerColors[c]);
  const choose = (c: Corner, choice: PeriodChoice) => {
    if (choice === "defer") {
      setDeferred(c);
      setChooser(c === "A" ? "B" : "A");
      return;
    }
    onSet({ type: "position", position: positionFromChoice(c, choice), chooser: c, choice });
  };
  const options: BoutPosition[] = ["A-top", "neutral", "B-top"];
  const optionLabel = (p: BoutPosition) => (p === "neutral" ? "Neutral" : `${color(p[0] as Corner)} on top`);

  if (needsChoice) {
    return (
      <div className="rounded-2xl bg-amber-50 p-4 ring-2 ring-amber-300">
        <div className="text-xs font-bold tracking-wide text-amber-900 uppercase">{overtime ? "Tiebreaker" : `Start of period ${period}`}: choice of position</div>
        {!chooser ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Who chooses?</span>
            {(["A", "B"] as Corner[]).map((c) => (
              <Button key={c} variant={suggested === c ? "primary" : "secondary"} onClick={() => setChooser(c)}>
                {names[c]} ({color(c)})
                {suggested === c ? " · their turn" : ""}
              </Button>
            ))}
            <button type="button" className="ml-auto text-sm font-semibold text-slate-500" onClick={() => onSet({ type: "position", position: "neutral", reason: "Period started neutral" })}>
              Skip: start neutral
            </button>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">
              {deferred ? `${names[deferred]} deferred. ` : ""}
              {names[chooser]} chooses:
            </span>
            {(["top", "bottom", "neutral", ...(deferred ? [] : ["defer"])] as PeriodChoice[]).map((choice) => (
              <Button key={choice} variant="secondary" onClick={() => choose(chooser, choice)}>
                {cap(choice)}
              </Button>
            ))}
            <button type="button" className="ml-auto text-sm font-semibold text-slate-500" onClick={() => (setChooser(null), setDeferred(null))}>
              Back
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <div>
        <div className="text-xs font-bold text-slate-500 uppercase">Position</div>
        <div className="text-lg font-bold">{optionLabel(state.position)}</div>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Set position">
        {options.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={state.position === p}
            onClick={() => state.position !== p && onSet({ type: "position", position: p, reason: "Set by table" })}
            className={cx(
              "rounded-lg px-3 py-2 text-sm font-bold ring-2",
              state.position === p
                ? p === "A-top"
                  ? "bg-red-600 text-white ring-red-600"
                  : p === "B-top"
                    ? "bg-emerald-600 text-white ring-emerald-600"
                    : "bg-slate-700 text-white ring-slate-700"
                : "ring-slate-200",
            )}
          >
            {optionLabel(p)}
          </button>
        ))}
      </div>
    </div>
  );
}
