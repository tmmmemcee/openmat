import { RULESETS } from "@openmat/core";
import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { type Bout, type QueueItem, api } from "../../api";
import { BoutBox, type WrestlerMap, wrestlerName } from "../../components/BracketView";
import { useEvent, useEventMutation, useMatQueue } from "../../lib/hooks";
import { useOutbox } from "../../lib/outbox";
import { Badge, Button, ErrorBox, Header, Notice, Page, Spinner, cx } from "../../ui";
import { ResultDialog } from "./ResultDialog";
import { ScoreScreen } from "./ScoreScreen";

const clockTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");

/** The scoring table for one mat: its queue, and live scoring for the current bout. */
export default function TableApp() {
  const { slug = "", mat: matParam = "1" } = useParams();
  const mat = Number(matParam);
  const event = useEvent(slug);
  const queue = useMatQueue(slug, mat);
  const outbox = useOutbox(slug);
  const [params, setParams] = useSearchParams();
  const [manual, setManual] = useState<Bout | null>(null);
  const wrestlers: WrestlerMap = useMemo(() => new Map((queue.data?.wrestlers ?? []).map((w) => [w.id, w])), [queue.data]);
  const start = useEventMutation(slug, (id: string) => api(`/events/${slug}/bouts/${id}/start`, { method: "POST", slug }));

  if (event.isLoading) return <Spinner />;
  if (!event.data) return <ErrorBox error={event.error} />;
  const access = event.data.access;
  const allowed = access?.role === "director" || (access?.role === "table" && access.mat === mat);
  const ruleset = RULESETS.find((r) => r.id === event.data.ruleset?.id);
  if (!allowed || !ruleset) {
    return (
      <>
        <Header title={event.data.name} subtitle={`Mat ${mat} table`} />
        <Page className="max-w-xl">
          <Notice tone="amber">
            {access?.role === "table" ? `This link is for mat ${access.mat}.` : "Open the table link for this mat from the tournament director."}
          </Notice>
        </Page>
      </>
    );
  }

  const boutId = params.get("bout");
  if (boutId) {
    return <ScoreScreen slug={slug} boutId={boutId} ruleset={ruleset} mat={mat} onDone={() => setParams({})} />;
  }

  const items = queue.data?.queue ?? [];
  return (
    <>
      <Header
        title={`Mat ${mat}`}
        subtitle={event.data.name}
        right={
          outbox.length > 0 ? (
            <Badge tone="amber">{outbox.length} taps waiting to sync</Badge>
          ) : (
            <Badge tone="green">Synced</Badge>
          )
        }
      />
      <Page className="max-w-3xl space-y-4">
        <ErrorBox error={queue.error ?? start.error} />
        {queue.isLoading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <Notice tone="gray">No bouts waiting on this mat. {queue.data?.recent.length ? "Nice work!" : "The schedule isn't out yet."}</Notice>
        ) : (
          <ul className="space-y-3">
            {items.map((q) => (
              <QueueCard
                key={q.bout.id}
                item={q}
                wrestlers={wrestlers}
                onScore={() => {
                  if (q.bout.status === "ready") start.mutate(q.bout.id);
                  setParams({ bout: q.bout.id });
                }}
                onManual={() => setManual(q.bout)}
              />
            ))}
          </ul>
        )}

        {(queue.data?.recent.length ?? 0) > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-500 uppercase">Finished on this mat</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {queue.data!.recent.map((r) => (
                <li key={r.bout.id} className="space-y-1">
                  <BoutBox bout={r.bout} wrestlers={wrestlers} />
                  <button type="button" className="text-xs font-semibold text-brand-700" onClick={() => setManual(r.bout)}>
                    Fix result
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Page>
      {manual && <ResultDialog slug={slug} bout={manual} ruleset={ruleset} wrestlers={wrestlers} onClose={() => setManual(null)} />}
    </>
  );
}

function QueueCard({ item, wrestlers, onScore, onManual }: { item: QueueItem; wrestlers: WrestlerMap; onScore: () => void; onManual: () => void }) {
  const { bout } = item;
  const known = bout.status === "ready" || bout.status === "wrestling";
  const labels: Record<QueueItem["position"], [string, string]> = {
    wrestling: ["Wrestling now", "bg-brand-700 text-white"],
    "on-deck": ["On deck", "bg-amber-400 text-slate-900"],
    "in-the-hole": ["In the hole", "bg-amber-100 text-amber-900"],
    queued: [`#${item.place} in line`, "bg-slate-100 text-slate-600"],
  };
  const [label, style] = labels[item.position];
  const person = (id: string | null, from: string | undefined, color: string) => (
    <div className="flex items-center gap-2">
      <span className={cx("h-8 w-1.5 rounded-full", color)} />
      <div className="min-w-0">
        <div className={cx("truncate font-semibold", !id && "font-normal text-slate-400 italic")}>{id ? wrestlerName(wrestlers, id) : (from ?? "TBD")}</div>
        {id && <div className="truncate text-xs text-slate-500">{wrestlers.get(id)?.team}</div>}
      </div>
    </div>
  );
  return (
    <li className={cx("rounded-xl bg-white p-4 shadow-sm ring-1", item.position === "wrestling" ? "ring-2 ring-brand-600" : "ring-slate-200")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-bold", style)}>{label}</span>
          <span className="font-bold">Bout {bout.boutNumber}</span>
          <span className="text-sm text-slate-500">{item.bracketName}</span>
        </div>
        <span className="text-sm text-slate-500">{item.position !== "wrestling" && item.estimatedStart ? `~${clockTime(item.estimatedStart)}` : ""}</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {person(bout.a, bout.aFrom, "bg-red-500")}
        {person(bout.b, bout.bFrom, "bg-emerald-500")}
      </div>
      {item.restHoldUntil && known && (
        <p className="mt-2 text-sm text-amber-800">A wrestler needs rest until {clockTime(item.restHoldUntil)}. You can wrestle a later bout first.</p>
      )}
      {!known && <p className="mt-2 text-sm text-slate-500">Waiting for earlier results.</p>}
      {known && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={onScore}>{bout.status === "wrestling" ? "Continue scoring" : "Start & score"}</Button>
          <Button variant="secondary" onClick={onManual}>
            Enter result only
          </Button>
        </div>
      )}
    </li>
  );
}
