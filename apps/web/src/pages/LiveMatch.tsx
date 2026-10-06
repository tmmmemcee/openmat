import { RULESETS } from "@openmat/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { type BoutDetail, type Play, api } from "../api";
import { LiveClock } from "../components/LiveClock";
import { positionText } from "../components/Live";
import { useEvent } from "../lib/hooks";
import { ErrorBox, Header, Page, Spinner, cx } from "../ui";

type Corner = "A" | "B";

const CORNER = {
  A: { panel: "bg-red-600", text: "text-red-600", dot: "bg-red-600", fill: "#dc2626" },
  B: { panel: "bg-emerald-600", text: "text-emerald-700", dot: "bg-emerald-600", fill: "#059669" },
} as const;

const fmt = (sec?: number) => (sec === undefined ? "" : `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Public live view of one bout: score, position, clock and play-by-play. */
export default function LiveMatch() {
  const { slug = "", boutId = "" } = useParams();
  const event = useEvent(slug);
  const detail = useQuery({
    queryKey: ["bout-live", slug, boutId],
    queryFn: () => api<BoutDetail>(`/events/${slug}/bouts/${boutId}`),
    refetchInterval: (q) => (q.state.data?.bout.status === "done" ? 30_000 : 2_000),
  });

  if (event.isLoading || detail.isLoading) return <Spinner />;
  if (!event.data || !detail.data) return <ErrorBox error={event.error ?? detail.error} />;
  const d = detail.data;
  const ruleset = RULESETS.find((r) => r.id === d.rulesetId);
  const colors = ruleset?.cornerColors ?? { A: "red", B: "green" };
  const names = { A: cap(colors.A), B: cap(colors.B) };
  const who = (c: Corner) => d.wrestlers.find((w) => w.id === (c === "A" ? d.bout.a : d.bout.b));
  const score = d.live?.score ?? d.bout.result?.score ?? d.state.score;
  const position = ruleset?.tracksPosition ? (d.live?.position ?? d.state.position) : null;
  const status = d.bout.status;
  const winner = d.bout.result?.winner;

  return (
    <>
      <Header title={event.data.name} subtitle={`${d.bracketName} · ${d.bout.label}`} />
      <Page className="max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm font-semibold">
          <div className="flex gap-3">
            <Link to={`/e/${slug}/mats`} className="text-brand-700">
              ← Mats
            </Link>
            <Link to={`/e/${slug}/brackets?b=${d.bout.bracketId}`} className="text-brand-700">
              Bracket
            </Link>
          </div>
          <span className="text-slate-500">
            {d.bout.mat ? `Mat ${d.bout.mat}` : ""}
            {d.bout.boutNumber ? ` · Bout ${d.bout.boutNumber}` : ""}
          </span>
        </div>

        {/* Status: live clock, final result, or not started */}
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white">
          {status === "wrestling" ? (
            <>
              <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-black tracking-widest">LIVE</span>
              <span className="font-mono text-4xl font-black">
                {d.live?.clock ? <LiveClock clock={d.live.clock} serverNow={d.serverNow} periods={d.periodsSec.length} /> : "—"}
              </span>
            </>
          ) : status === "done" && d.bout.result ? (
            <span className="text-xl font-bold">
              Final · {who(d.bout.result.winner)?.firstName} {who(d.bout.result.winner)?.lastName} wins · {d.bout.result.summary}
            </span>
          ) : (
            <span className="text-lg font-semibold">{status === "waiting" ? "Waiting on earlier results" : "Not started yet"}</span>
          )}
        </div>

        {/* Scoreboard */}
        <div className="grid grid-cols-2 gap-3">
          {(["A", "B"] as Corner[]).map((c) => {
            const w = who(c);
            const own = position ? (position === "neutral" ? "Neutral" : position === `${c}-top` ? "On top" : "Bottom") : null;
            return (
              <section key={c} className={cx("rounded-2xl p-4 text-white", CORNER[c].panel, winner && winner !== c && "opacity-70")}>
                <div className="flex items-center gap-3">
                  {w?.photoUrl && w.photoConsent && <img src={w.photoUrl} alt="" className="size-12 rounded-full object-cover ring-2 ring-white/60" />}
                  <div className="min-w-0">
                    <div className="text-xs font-bold tracking-wider uppercase opacity-80">{names[c]}</div>
                    <div className="truncate text-lg font-bold sm:text-2xl">{w ? `${w.firstName} ${w.lastName}` : (c === "A" ? d.bout.aFrom : d.bout.bFrom) ?? "TBD"}</div>
                    <div className="truncate text-sm opacity-80">{w?.team}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <span className="text-6xl font-black tabular-nums sm:text-8xl">{score[c]}</span>
                  {own && status === "wrestling" && <span className="rounded-full bg-white/20 px-2.5 py-1 text-sm font-bold whitespace-nowrap">{own}</span>}
                  {winner === c && <span className="rounded-full bg-white/20 px-2.5 py-1 text-sm font-bold whitespace-nowrap">Winner</span>}
                </div>
              </section>
            );
          })}
        </div>

        {position && status === "wrestling" && <PositionDiagram position={position} names={names} />}

        <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <h2 className="border-b border-slate-100 px-4 py-2.5 text-sm font-bold tracking-wide text-slate-500 uppercase">Play-by-play</h2>
          {d.plays.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">No scoring yet.</p>
          ) : (
            <ol className="divide-y divide-slate-100">
              {[...d.plays].reverse().map((p) => (
                <PlayRow key={p.id} play={p} name={(c) => who(c)?.firstName ?? names[c]} periodsSec={d.periodsSec} />
              ))}
            </ol>
          )}
        </section>
      </Page>
    </>
  );
}

/** Time left in the period when a play happened, like the clock shows it. Overtime periods are 1 minute. */
function clockAt(play: Play, periodsSec: number[]): string {
  if (!play.period || play.matchTimeSec === undefined) return "";
  const length = (p: number) => periodsSec[p - 1] ?? 60;
  const before = Array.from({ length: play.period - 1 }, (_, i) => length(i + 1)).reduce((a, b) => a + b, 0);
  const left = Math.max(0, length(play.period) - (play.matchTimeSec - before));
  const label = play.period > periodsSec.length ? `OT${play.period - periodsSec.length > 1 ? play.period - periodsSec.length : ""}` : `P${play.period}`;
  return `${label} ${fmt(left)}`;
}

function PlayRow({ play, name, periodsSec }: { play: Play; name: (c: Corner) => string; periodsSec: number[] }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <span className="w-16 shrink-0 text-xs text-slate-400 tabular-nums">{clockAt(play, periodsSec)}</span>
      {play.corner && <span className={cx("size-2.5 shrink-0 rounded-full", CORNER[play.corner].dot)} />}
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{play.corner ? name(play.corner) : ""}</span> {play.kind === "score" ? play.label.toLowerCase() : play.label}
        {play.points > 0 && <span className={cx("ml-1.5 font-bold", play.corner && CORNER[play.corner].text)}>+{play.points}</span>}
      </span>
      <span className="shrink-0 font-semibold tabular-nums">
        <span className="text-red-600">{play.score.A}</span>–<span className="text-emerald-700">{play.score.B}</span>
      </span>
    </li>
  );
}

/** A mat seen from above: both wrestlers standing, or one on top of the other. */
function PositionDiagram({ position, names }: { position: "neutral" | "A-top" | "B-top"; names: Record<Corner, string> }) {
  const label = positionText(position, names);
  const top: Corner | null = position === "neutral" ? null : (position[0] as Corner);
  const bottom: Corner | null = top ? (top === "A" ? "B" : "A") : null;
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200" aria-label={`Position: ${label}`}>
      <svg viewBox="0 0 160 100" className="h-24 w-40 shrink-0" role="img" aria-hidden="true">
        <circle cx="80" cy="50" r="46" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="2" />
        <circle cx="80" cy="50" r="10" fill="none" stroke="#cbd5e1" strokeWidth="1.5" />
        {top && bottom ? (
          <>
            <ellipse cx="80" cy="56" rx="30" ry="14" fill={CORNER[bottom].fill} opacity="0.9" />
            <ellipse cx="80" cy="44" rx="24" ry="12" fill={CORNER[top].fill} stroke="#fff" strokeWidth="2" />
          </>
        ) : (
          <>
            <circle cx="62" cy="50" r="14" fill={CORNER.A.fill} />
            <circle cx="98" cy="50" r="14" fill={CORNER.B.fill} />
          </>
        )}
      </svg>
      <div>
        <div className="text-xs font-bold tracking-wide text-slate-500 uppercase">Position</div>
        <div className="text-xl font-bold">{label}</div>
        {top && bottom && (
          <div className="text-sm text-slate-600">
            {names[top]} on top, {names[bottom]} underneath
          </div>
        )}
      </div>
    </section>
  );
}
