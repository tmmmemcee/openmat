import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { MatQueue, QueueItem } from "../api";
import { LiveClock } from "../components/LiveClock";
import { QrCode } from "../components/QrCode";
import { useAllMats, useEvent } from "../lib/hooks";
import { ErrorBox, Header, Input, Page, Spinner, cx } from "../ui";

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");

/** Every mat at a glance: wrestling now, on deck, in the hole. Add ?tv=1 for a gym TV. */
export default function MatBoard() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const tv = params.get("tv") === "1";
  const event = useEvent(slug);
  const [query, setQuery] = useState("");
  const all = useAllMats(slug);
  const results = Array.from({ length: event.data?.settings.mats ?? 0 }, (_, i) => ({ data: all.data?.[i] }));

  if (event.isLoading) return <Spinner />;
  if (!event.data) return <ErrorBox error={event.error} />;
  const q = query.trim().toLowerCase();

  const board = (
    <div className={cx("grid gap-4", tv ? "grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3")}>
      {results.map((r, i) => (
        <MatColumn key={i} mat={i + 1} data={r.data} tv={tv} query={q} periods={Math.max(0, ...event.data.divisions.map((d) => d.periodsSec.length))} />
      ))}
    </div>
  );

  if (tv) {
    return (
      <div className="min-h-screen bg-slate-900 p-4 text-white">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h1 className="text-3xl font-black">{event.data.name}</h1>
          <div className="flex items-center gap-3">
            <div className="text-right text-lg leading-tight font-bold">
              Scan to follow
              <br />
              your wrestler
            </div>
            <QrCode text={`${window.location.origin}/e/${slug}/follow`} className="w-24 rounded-md" label="QR code: follow your wrestler" />
          </div>
        </div>
        {board}
      </div>
    );
  }
  return (
    <>
      <Header title={event.data.name} subtitle="Mats" />
      <Page className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-3 text-sm font-semibold">
            <Link to={`/e/${slug}`} className="text-brand-700">
              ← Tournament
            </Link>
            <Link to={`/e/${slug}/brackets`} className="text-brand-700">
              Brackets
            </Link>
          <Link to={`/e/${slug}/follow`} className="text-brand-700">
            🔔 My wrestlers
          </Link>
          </div>
          <Input className="max-w-xs" placeholder="Highlight a wrestler or team…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {board}
        <p className="text-xs text-slate-500">Updates every few seconds. Times are estimates based on how fast each mat is moving.</p>
      </Page>
    </>
  );
}

function MatColumn({ mat, data, tv, query, periods }: { mat: number; data?: MatQueue; tv: boolean; query: string; periods: number }) {
  const names = new Map((data?.wrestlers ?? []).map((w) => [w.id, w]));
  const items = (data?.queue ?? []).slice(0, tv ? 3 : 5);
  const who = (id: string | null, from?: string) => {
    if (!id) return { name: from ?? "TBD", team: "", hit: false };
    const w = names.get(id);
    const name = w ? `${w.firstName} ${w.lastName}` : "?";
    return { name, team: w?.team ?? "", hit: !!query && `${name} ${w?.team}`.toLowerCase().includes(query) };
  };
  const label: Record<QueueItem["position"], string> = { wrestling: "Now", "on-deck": "On deck", "in-the-hole": "In the hole", queued: "Next" };
  return (
    <section className={cx("overflow-hidden rounded-2xl shadow-sm", tv ? "bg-slate-800" : "bg-white ring-1 ring-slate-200")}>
      <h2 className={cx("px-4 py-2 font-black", tv ? "bg-amber-400 text-2xl text-slate-900" : "bg-brand-900 text-lg text-white")}>Mat {mat}</h2>
      {items.length === 0 ? (
        <p className={cx("p-4 text-sm", tv ? "text-slate-400" : "text-slate-500")}>Nothing scheduled.</p>
      ) : (
        <ul className={cx("divide-y", tv ? "divide-slate-700" : "divide-slate-100")}>
          {items.map((q) => {
            const a = who(q.bout.a, q.bout.aFrom);
            const b = who(q.bout.b, q.bout.bFrom);
            return (
              <li key={q.bout.id} className={cx("px-4 py-3", (a.hit || b.hit) && (tv ? "bg-amber-900/40" : "bg-amber-50"))}>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cx(
                      "rounded-full px-2 py-0.5 font-bold",
                      tv ? "text-sm" : "text-xs",
                      q.position === "wrestling" ? "bg-red-600 text-white" : q.position === "on-deck" ? "bg-amber-400 text-slate-900" : tv ? "bg-slate-700" : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {label[q.position]}
                  </span>
                  <span className={cx(tv ? "text-base text-slate-300" : "text-xs text-slate-500")}>
                    {q.live?.clock && data && (
                      <span className={cx("mr-2 font-bold", tv ? "text-white" : "text-slate-900")}>
                        <LiveClock clock={q.live.clock} serverNow={data.serverNow} periods={periods} />
                      </span>
                    )}
                    #{q.bout.boutNumber}
                    {q.position !== "wrestling" && q.estimatedStart ? ` · ~${time(q.estimatedStart)}` : ""}
                  </span>
                </div>
                {[a, b].map((p, i) => {
                  const corner = i === 0 ? "A" : "B";
                  const onTop = q.live?.position === `${corner}-top`;
                  return (
                    <div key={i} className={cx("mt-1 flex items-baseline gap-2", tv ? "text-xl" : "text-sm")}>
                      <span className={cx("h-3 w-1 shrink-0 self-center rounded-full", i === 0 ? "bg-red-500" : "bg-emerald-500")} />
                      <span className={cx("truncate font-semibold", p.hit && "underline")}>{p.name}</span>
                      <span className={cx("min-w-0 flex-1 truncate", tv ? "text-base text-slate-400" : "text-xs text-slate-500")}>{p.team}</span>
                      {onTop && (
                        <span className={cx("shrink-0 rounded px-1.5 text-[10px] font-bold uppercase", tv ? "bg-slate-600 text-white" : "bg-slate-200 text-slate-700")} title="On top">
                          Top
                        </span>
                      )}
                      {q.live && <span className={cx("shrink-0 font-black tabular-nums", tv ? "text-2xl" : "text-base")}>{q.live.score[corner]}</span>}
                    </div>
                  );
                })}
                {q.live?.position === "neutral" && <div className={cx("mt-0.5 text-[11px]", tv ? "text-slate-400" : "text-slate-500")}>Neutral</div>}
                <div className={cx("mt-1 truncate", tv ? "text-sm text-slate-400" : "text-xs text-slate-400")}>{q.bracketName}</div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
