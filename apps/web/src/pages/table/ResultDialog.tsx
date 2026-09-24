import { type Ruleset, manualOutcome } from "@openmat/core";
import { useState } from "react";
import { type Bout, api } from "../../api";
import { type WrestlerMap, wrestlerName } from "../../components/BracketView";
import { useEventMutation } from "../../lib/hooks";
import { Button, Dialog, ErrorBox, Field, Input, Notice, Select, cx } from "../../ui";
import { NEEDS_SCORE, NEEDS_TIME, WIN_TYPE_LABELS, cap } from "./labels";

/** Enter or fix a result by hand: winner, how, score, time. */
export function ResultDialog({
  slug,
  bout,
  ruleset,
  wrestlers,
  onClose,
}: {
  slug: string;
  bout: Bout;
  ruleset: Ruleset;
  wrestlers: WrestlerMap;
  onClose: () => void;
}) {
  const prev = bout.result;
  const [winner, setWinner] = useState<"A" | "B" | null>(prev?.winner ?? null);
  const [winType, setWinType] = useState(prev?.winType ?? Object.keys(ruleset.teamPoints).find((k) => k === "DEC" || k === "VPO1")!);
  const [a, setA] = useState(prev ? String(prev.score.A) : "");
  const [b, setB] = useState(prev ? String(prev.score.B) : "");
  const [time, setTime] = useState("");
  const timeSec = /^\d{1,2}:\d{2}$/.test(time) ? Number(time.split(":")[0]) * 60 + Number(time.split(":")[1]) : undefined;
  const score = NEEDS_SCORE.has(winType) ? { A: Number(a || 0), B: Number(b || 0) } : undefined;
  const check = winner ? manualOutcome(ruleset, { winner, winType: winType as never, ...(score ? { score } : {}), ...(timeSec !== undefined ? { matchTimeSec: timeSec } : {}) }) : null;

  const save = useEventMutation(slug, () =>
    api(`/events/${slug}/bouts/${bout.id}/finish`, {
      method: "POST",
      slug,
      body: { mode: "manual", winner, winType, ...(score ? { score } : {}), ...(timeSec !== undefined ? { matchTimeSec: timeSec } : {}) },
    }),
  );
  const side = (c: "A" | "B") => {
    const id = c === "A" ? bout.a : bout.b;
    return (
      <button
        type="button"
        onClick={() => setWinner(c)}
        className={cx(
          "flex-1 rounded-xl p-3 text-left ring-2 transition",
          winner === c ? (c === "A" ? "bg-red-50 ring-red-500" : "bg-emerald-50 ring-emerald-500") : "ring-slate-200",
        )}
      >
        <div className={cx("text-xs font-bold uppercase", c === "A" ? "text-red-600" : "text-emerald-700")}>{ruleset.cornerColors[c]}</div>
        <div className="font-semibold">{wrestlerName(wrestlers, id)}</div>
        <div className="text-xs text-slate-500">{id ? wrestlers.get(id)?.team : ""}</div>
      </button>
    );
  };

  return (
    <Dialog open onClose={onClose} title={`${prev ? "Fix result" : "Enter result"} · Bout ${bout.boutNumber ?? bout.key}`}>
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Winner</p>
          <div className="flex gap-3">
            {side("A")}
            {side("B")}
          </div>
        </div>
        <Field label="How">
          <Select value={winType} onChange={(e) => setWinType(e.target.value)}>
            {Object.keys(ruleset.teamPoints).map((k) => (
              <option key={k} value={k}>
                {WIN_TYPE_LABELS[k] ?? k}
              </option>
            ))}
          </Select>
        </Field>
        {NEEDS_SCORE.has(winType) && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${cap(ruleset.cornerColors.A)} score`}>
              <Input type="number" inputMode="numeric" min={0} value={a} onChange={(e) => setA(e.target.value)} />
            </Field>
            <Field label={`${cap(ruleset.cornerColors.B)} score`}>
              <Input type="number" inputMode="numeric" min={0} value={b} onChange={(e) => setB(e.target.value)} />
            </Field>
          </div>
        )}
        {NEEDS_TIME.has(winType) && (
          <Field label="Match time (m:ss)" hint="Optional. Time on the match clock when it ended.">
            <Input inputMode="numeric" placeholder="1:36" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        )}
        {check && !check.ok && <Notice tone="amber">{check.message}</Notice>}
        {check?.ok && (
          <Notice tone="green">
            Result: <strong>{check.outcome.summary}</strong> for {wrestlerName(wrestlers, check.outcome.winner === "A" ? bout.a : bout.b)}
          </Notice>
        )}
        <ErrorBox error={save.error} />
        <div className="flex justify-end">
          <Button disabled={!check?.ok || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            {save.isPending ? "Saving…" : "Save result"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
