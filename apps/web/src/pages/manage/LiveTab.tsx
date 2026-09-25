import { RULESETS } from "@openmat/core";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { type Bout, type EventInfo, type QueueItem, api } from "../../api";
import { wrestlerName } from "../../components/BracketView";
import { useAllMats, useBrackets, useEventMutation } from "../../lib/hooks";
import { Badge, Button, Card, ErrorBox, Notice, cx } from "../../ui";
import { ResultDialog } from "../table/ResultDialog";

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");

/** Director's tournament-day console: every mat's line, with moves, resets and fixes. */
export default function LiveTab({ event }: { event: EventInfo }) {
  const slug = event.slug;
  const brackets = useBrackets(slug);
  const mats = Array.from({ length: event.settings.mats }, (_, i) => i + 1);
  const all = useAllMats(slug, 5_000);
  const queues = mats.map((_, i) => ({ data: all.data?.[i] }));
  const [fixing, setFixing] = useState<Bout | null>(null);
  const wrestlers = useMemo(() => new Map((brackets.data?.wrestlers ?? []).map((w) => [w.id, w])), [brackets.data]);
  const ruleset = RULESETS.find((r) => r.id === event.ruleset?.id);

  const move = useEventMutation(slug, ({ id, mat, position }: { id: string; mat: number; position?: number }) =>
    api(`/events/${slug}/bouts/${id}`, { method: "PATCH", slug, body: { mat, ...(position ? { position } : {}) } }),
  );
  const reset = useEventMutation(slug, (id: string) => api(`/events/${slug}/bouts/${id}/reset`, { method: "POST", slug }));

  const allBouts = (brackets.data?.brackets ?? []).flatMap((b) => b.bouts.map((bout) => ({ bout, bracket: b.name })));
  const conflicts = allBouts.filter((x) => x.bout.conflict);
  const scheduled = allBouts.some((x) => x.bout.mat);
  const done = allBouts.filter((x) => x.bout.status === "done").length;
  const real = allBouts.filter((x) => x.bout.status !== "bye" && x.bout.status !== "not-needed").length;

  if (!scheduled) {
    return (
      <Notice tone="gray">
        Nothing on the mats yet. Make brackets and build the schedule in the{" "}
        <Link to={`/e/${slug}/manage/brackets`} className="font-semibold underline">
          Brackets & mats
        </Link>{" "}
        tab.
      </Notice>
    );
  }

  const names = (b: Bout) =>
    `${wrestlerName(wrestlers, b.a) ?? b.aFrom ?? "TBD"} vs ${wrestlerName(wrestlers, b.b) ?? b.bFrom ?? "TBD"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge tone="blue">
          {done}/{real} bouts done
        </Badge>
        <Link to={`/e/${slug}/mats`} target="_blank" className="font-semibold text-brand-700">
          Public mat board ↗
        </Link>
        <Link to={`/e/${slug}/mats?tv=1`} target="_blank" className="font-semibold text-brand-700">
          TV mode ↗
        </Link>
      </div>
      <ErrorBox error={move.error ?? reset.error} />

      {conflicts.length > 0 && (
        <Card className="ring-2 ring-red-300">
          <h2 className="font-bold text-red-800">Needs a look</h2>
          <p className="text-sm text-slate-600">An earlier result was changed, so these bouts were wrestled by the wrong wrestler. Reset them to wrestle again, or fix the earlier result back.</p>
          <ul className="mt-2 divide-y divide-slate-100">
            {conflicts.map(({ bout, bracket }) => (
              <li key={bout.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm">
                  <strong>Bout {bout.boutNumber}</strong> · {bracket} · {bout.result?.summary}
                </span>
                <span className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setFixing(bout)}>
                    Fix result
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => confirm(`Reset bout ${bout.boutNumber}? It goes back in line.`) && reset.mutate(bout.id)}>
                    Reset
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {queues.map((q, i) => {
          const mat = i + 1;
          const items = q.data?.queue ?? [];
          const last = items[items.length - 1];
          return (
            <section key={mat} className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <header className="flex items-center justify-between bg-brand-900 px-4 py-2 text-white">
                <h2 className="font-bold">Mat {mat}</h2>
                <span className="text-xs text-brand-100">
                  {items.length} left{last?.estimatedStart ? ` · last ~${time(last.estimatedStart)}` : ""}
                </span>
              </header>
              {items.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">Done.</p>
              ) : (
                <ol className="divide-y divide-slate-100">
                  {items.map((item, idx) => (
                    <LineItem
                      key={item.bout.id}
                      item={item}
                      label={names(item.bout)}
                      mats={mats}
                      canUp={idx > 0 && items[idx - 1]!.position !== "wrestling"}
                      canDown={idx < items.length - 1}
                      onMove={(toMat, position) => move.mutate({ id: item.bout.id, mat: toMat, ...(position ? { position } : {}) })}
                      lineIndex={items[0]?.position === "wrestling" ? idx : idx + 1}
                      onReset={() => confirm(`Reset bout ${item.bout.boutNumber}? It goes back in line and its clock is cleared.`) && reset.mutate(item.bout.id)}
                    />
                  ))}
                </ol>
              )}
              {(q.data?.recent.length ?? 0) > 0 && (
                <details className="border-t border-slate-100 px-4 py-2 text-sm">
                  <summary className="cursor-pointer text-slate-500">Finished ({q.data!.recent.length} recent)</summary>
                  <ul className="mt-1 space-y-1">
                    {q.data!.recent.map((r) => (
                      <li key={r.bout.id} className="flex items-center justify-between gap-2">
                        <span className="truncate">
                          #{r.bout.boutNumber} {wrestlerName(wrestlers, r.bout.winnerEntryId)} · {r.bout.result?.summary}
                        </span>
                        <button type="button" className="shrink-0 text-xs font-semibold text-brand-700" onClick={() => setFixing(r.bout)}>
                          Fix
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          );
        })}
      </div>
      {fixing && ruleset && <ResultDialog slug={slug} bout={fixing} ruleset={ruleset} wrestlers={wrestlers} onClose={() => setFixing(null)} />}
    </div>
  );
}

function LineItem({
  item,
  label,
  mats,
  canUp,
  canDown,
  lineIndex,
  onMove,
  onReset,
}: {
  item: QueueItem;
  label: string;
  mats: number[];
  canUp: boolean;
  canDown: boolean;
  lineIndex: number;
  onMove: (mat: number, position?: number) => void;
  onReset: () => void;
}) {
  const { bout } = item;
  const mat = bout.mat ?? 1;
  const badge: Record<QueueItem["position"], string> = { wrestling: "Now", "on-deck": "On deck", "in-the-hole": "Hole", queued: `#${item.place}` };
  return (
    <li className={cx("px-3 py-2", item.position === "wrestling" && "bg-brand-50")}>
      <div className="flex items-center gap-2">
        <span className={cx("w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-bold", item.position === "wrestling" ? "bg-brand-700 text-white" : item.position === "on-deck" ? "bg-amber-400" : "bg-slate-100 text-slate-600")}>
          {badge[item.position]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            #{bout.boutNumber} · {label}
          </span>
          <span className="block truncate text-xs text-slate-500">
            {item.bracketName}
            {item.position !== "wrestling" && item.estimatedStart ? ` · ~${time(item.estimatedStart)}` : ""}
            {item.restHoldUntil ? ` · rest until ${time(item.restHoldUntil)}` : ""}
          </span>
        </span>
        {item.position === "wrestling" ? (
          <button type="button" onClick={onReset} className="text-xs font-semibold text-red-700">
            Reset
          </button>
        ) : (
          <span className="flex shrink-0 items-center gap-1">
            <button type="button" disabled={!canUp} onClick={() => onMove(mat, lineIndex - 1)} className="rounded px-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Move up">
              ▲
            </button>
            <button type="button" disabled={!canDown} onClick={() => onMove(mat, lineIndex + 1)} className="rounded px-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Move down">
              ▼
            </button>
            <select
              aria-label="Move to mat"
              value=""
              onChange={(e) => onMove(Number(e.target.value))}
              className="rounded border-0 py-0.5 pr-6 pl-1.5 text-xs ring-1 ring-slate-300"
            >
              <option value="">Mat…</option>
              {mats
                .filter((m) => m !== mat)
                .map((m) => (
                  <option key={m} value={m}>
                    Mat {m}
                  </option>
                ))}
            </select>
          </span>
        )}
      </div>
    </li>
  );
}
