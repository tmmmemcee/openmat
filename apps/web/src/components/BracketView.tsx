import type { Bout, Bracket, Wrestler } from "../api";
import { Badge, cx } from "../ui";

export type WrestlerMap = Map<string, Wrestler>;

export const wrestlerName = (map: WrestlerMap, id: string | null | undefined) => {
  if (!id) return null;
  if (id === "BYE") return "Bye";
  const w = map.get(id);
  return w ? `${w.firstName} ${w.lastName}` : "?";
};

const formatLabel = (b: Bracket) =>
  b.format === "round-robin"
    ? "Round robin"
    : `${b.format === "double-elim" ? "Double elimination" : "Single elimination"} · ${b.size}-man${b.options.places ? ` · places 1–${b.options.places}` : ""}`;

export function BracketView({ bracket, wrestlers, highlight }: { bracket: Bracket; wrestlers: WrestlerMap; highlight?: string | null }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <Badge tone="gray">{formatLabel(bracket)}</Badge>
        <span>{bracket.draw.filter(Boolean).length} wrestlers</span>
      </div>
      {bracket.format === "round-robin" ? (
        <RoundRobin bracket={bracket} wrestlers={wrestlers} highlight={highlight} />
      ) : (
        <Elimination bracket={bracket} wrestlers={wrestlers} highlight={highlight} />
      )}
      {bracket.places.length > 0 && <Places bracket={bracket} wrestlers={wrestlers} />}
    </div>
  );
}

function Places({ bracket, wrestlers }: { bracket: Bracket; wrestlers: WrestlerMap }) {
  return (
    <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
      <h4 className="font-bold">Placements</h4>
      <ol className="mt-2 space-y-1 text-sm">
        {bracket.places.map((p) => (
          <li key={`${p.place}-${p.entryId}`} className="flex gap-2">
            <span className="w-8 font-bold">{ordinal(p.place)}</span>
            <span>
              {wrestlerName(wrestlers, p.entryId)} <span className="text-slate-500">{wrestlers.get(p.entryId)?.team}</span>
              {p.unresolvedTie && <Badge tone="amber">tie: director decides</Badge>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ordinal(n: number) {
  return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
}

/** One bout box: bout number and mat, both wrestlers, result. */
export function BoutBox({ bout, wrestlers, highlight, compact }: { bout: Bout; wrestlers: WrestlerMap; highlight?: string | null; compact?: boolean }) {
  if (bout.status === "bye" && compact) return null;
  const line = (id: string | null, from: string | undefined, corner: "A" | "B") => {
    const won = bout.winnerEntryId && bout.winnerEntryId === id;
    const team = id && id !== "BYE" ? wrestlers.get(id)?.team : undefined;
    return (
      <div className={cx("flex items-center gap-2 px-2.5 py-1.5", id && id === highlight && "bg-amber-100")}>
        <span className={cx("h-4 w-1 shrink-0 rounded-full", corner === "A" ? "bg-red-500" : "bg-emerald-500")} />
        <span className={cx("min-w-0 flex-1 truncate text-sm", won ? "font-bold" : "text-slate-700", !id && "text-slate-400 italic")}>
          {id ? wrestlerName(wrestlers, id) : (from ?? "TBD")}
          {team && <span className="ml-1.5 text-xs font-normal text-slate-500">{team}</span>}
        </span>
        {bout.result && (bout.result.score.A > 0 || bout.result.score.B > 0) && (
          <span className="text-sm font-semibold tabular-nums">{bout.result.score[corner]}</span>
        )}
      </div>
    );
  };
  return (
    <div className={cx("w-full overflow-hidden rounded-lg bg-white ring-1", bout.status === "wrestling" ? "ring-2 ring-brand-600" : "ring-slate-200", bout.conflict && "ring-2 ring-red-400")}>
      <div className="flex items-center justify-between gap-2 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
        <span>
          {bout.boutNumber ? `#${bout.boutNumber}` : bout.label}
          {bout.mat ? ` · Mat ${bout.mat}` : ""}
        </span>
        <span>
          {bout.status === "wrestling" && <span className="font-bold text-brand-700">LIVE</span>}
          {bout.result && bout.result.summary}
          {bout.status === "bye" && "Bye"}
          {bout.forPlace && !bout.result ? `${ordinal(bout.forPlace)} place` : ""}
        </span>
      </div>
      <div className="divide-y divide-slate-100">
        {line(bout.a, bout.aFrom, "A")}
        {line(bout.b, bout.bFrom, "B")}
      </div>
      {bout.conflict && <p className="bg-red-50 px-2.5 py-1 text-xs text-red-800">{bout.conflict}</p>}
    </div>
  );
}

function RoundRobin({ bracket, wrestlers, highlight }: { bracket: Bracket; wrestlers: WrestlerMap; highlight?: string | null }) {
  const pool = bracket.draw.filter((x): x is string => !!x);
  const boutFor = (x: string, y: string) => bracket.bouts.find((b) => (b.a === x && b.b === y) || (b.a === y && b.b === x));
  const record = (id: string) => {
    const done = bracket.bouts.filter((b) => b.winnerEntryId && (b.a === id || b.b === id));
    const w = done.filter((b) => b.winnerEntryId === id).length;
    return `${w}-${done.length - w}`;
  };
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="text-xs text-slate-500">
              <th className="p-2 text-left">Wrestler</th>
              {pool.map((id, i) => (
                <th key={id} className="p-2 text-center">
                  {i + 1}
                </th>
              ))}
              <th className="p-2 text-center">W-L</th>
            </tr>
          </thead>
          <tbody>
            {pool.map((id, i) => (
              <tr key={id} className={cx("border-t border-slate-100", id === highlight && "bg-amber-50")}>
                <td className="p-2">
                  <span className="mr-2 text-slate-400">{i + 1}</span>
                  <span className="font-medium">{wrestlerName(wrestlers, id)}</span>
                  <span className="ml-1.5 text-xs text-slate-500">{wrestlers.get(id)?.team}</span>
                </td>
                {pool.map((other) => {
                  if (other === id) return <td key={other} className="bg-slate-100 p-2" />;
                  const b = boutFor(id, other);
                  const won = b?.winnerEntryId === id;
                  return (
                    <td key={other} className="p-2 text-center text-xs">
                      {b?.result ? <span className={won ? "font-bold text-emerald-700" : "text-slate-500"}>{won ? "W" : "L"} {b.result.summary}</span> : <span className="text-slate-300">{b?.boutNumber ? `#${b.boutNumber}` : "·"}</span>}
                    </td>
                  );
                })}
                <td className="p-2 text-center font-semibold">{record(id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {[...bracket.bouts]
          .sort((x, y) => (x.plannedStartMin ?? x.round * 1000) - (y.plannedStartMin ?? y.round * 1000))
          .map((b) => (
            <BoutBox key={b.id} bout={b} wrestlers={wrestlers} highlight={highlight} />
          ))}
      </div>
    </div>
  );
}

function Elimination({ bracket, wrestlers, highlight }: { bracket: Bracket; wrestlers: WrestlerMap; highlight?: string | null }) {
  const bySection = (section: Bout["section"]) => bracket.bouts.filter((b) => b.section === section);
  const columns = (list: Bout[]) => {
    const rounds = [...new Set(list.map((b) => b.key.split("-")[0]!))];
    return rounds.map((r) => list.filter((b) => b.key.split("-")[0] === r));
  };
  const Columns = ({ list, title }: { list: Bout[]; title: string }) =>
    list.length ? (
      <div>
        <h4 className="mb-2 text-sm font-bold text-slate-600 uppercase">{title}</h4>
        <div className="overflow-x-auto pb-2">
          <div className="flex min-w-max gap-3">
            {columns(list).map((col, i) => (
              <div key={i} className="flex w-56 flex-col justify-around gap-2">
                <div className="text-center text-xs font-semibold text-slate-500">{col[0]!.label}</div>
                {col.map((b) =>
                  b.status === "bye" ? (
                    <div key={b.id} className="rounded-lg border border-dashed border-slate-200 px-2.5 py-2 text-xs text-slate-400">
                      {wrestlerName(wrestlers, b.a === "BYE" ? b.b : b.a) ?? "—"} · bye
                    </div>
                  ) : (
                    <BoutBox key={b.id} bout={b} wrestlers={wrestlers} highlight={highlight} />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    ) : null;
  const placement = bySection("placement").filter((b) => b.status !== "not-needed");
  return (
    <div className="space-y-5">
      <Columns list={bySection("championship")} title="Championship" />
      <Columns list={bySection("consolation")} title="Wrestlebacks" />
      {placement.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-bold text-slate-600 uppercase">Placement matches</h4>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {placement.map((b) => (
              <div key={b.id}>
                <div className="mb-1 text-xs font-semibold text-slate-500">{b.label}</div>
                <BoutBox bout={b} wrestlers={wrestlers} highlight={highlight} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
