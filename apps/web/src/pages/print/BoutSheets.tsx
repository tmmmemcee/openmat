import { RULESETS } from "@openmat/core";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import type { Bout, EventInfo } from "../../api";
import { type WrestlerMap, wrestlerName } from "../../components/BracketView";
import { useBrackets, useEvent } from "../../lib/hooks";
import { ErrorBox, Spinner, cx } from "../../ui";
import { WIN_TYPE_LABELS, cap } from "../table/labels";
import { PrintToolbar } from "./PrintToolbar";

type Filter = "known" | "all" | "unfinished";

/** Printable bout sheets for the scorer's table: two per page, by mat. */
export default function BoutSheets() {
  const { slug = "" } = useParams();
  const event = useEvent(slug);
  const data = useBrackets(slug);
  const [mat, setMat] = useState<number | "all">("all");
  const [filter, setFilter] = useState<Filter>("known");
  const wrestlers = useMemo(() => new Map((data.data?.wrestlers ?? []).map((w) => [w.id, w])), [data.data]);
  if (event.isLoading || data.isLoading) return <Spinner />;
  if (!event.data || !data.data) return <ErrorBox error={event.error ?? data.error} />;
  const ev = event.data;
  const bracketName = new Map(data.data.brackets.map((b) => [b.id, b.name]));
  const bouts = data.data.brackets
    .flatMap((b) => b.bouts)
    .filter((b) => b.mat && (mat === "all" || b.mat === mat))
    .filter((b) =>
      filter === "all" ? b.status !== "bye" && b.status !== "not-needed" : filter === "known" ? b.status === "ready" || b.status === "wrestling" : b.status !== "done" && b.status !== "bye" && b.status !== "not-needed",
    )
    .sort((x, y) => (x.mat ?? 0) - (y.mat ?? 0) || (x.matOrder ?? 0) - (y.matOrder ?? 0));
  const division = (b: Bout) => ev.divisions.find((d) => d.id === data.data!.brackets.find((x) => x.id === b.bracketId)?.divisionId);

  return (
    <div className="bg-white">
      <style>{"@page { size: letter portrait; margin: 0.4in; }"}</style>
      <PrintToolbar title={`Bout sheets · ${ev.name}`} count={`${bouts.length} sheets, two per page`}>
        <select className="rounded-md px-2 py-1.5 text-sm ring-1 ring-slate-300" value={mat} onChange={(e) => setMat(e.target.value === "all" ? "all" : Number(e.target.value))}>
          <option value="all">All mats</option>
          {Array.from({ length: ev.settings.mats }, (_, i) => (
            <option key={i} value={i + 1}>
              Mat {i + 1}
            </option>
          ))}
        </select>
        <select className="rounded-md px-2 py-1.5 text-sm ring-1 ring-slate-300" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="known">Both wrestlers known</option>
          <option value="unfinished">Everything not wrestled yet</option>
          <option value="all">Every bout</option>
        </select>
      </PrintToolbar>
      <div className="mx-auto max-w-[7.7in] print:max-w-none">
        {bouts.length === 0 && <p className="p-8 text-center text-slate-500 print:hidden">No bouts match.</p>}
        {bouts.map((b, i) => (
          <div key={b.id} className={cx(i % 2 === 1 && "break-after-page")}>
            <Sheet event={ev} bout={b} bracket={bracketName.get(b.bracketId) ?? ""} periodsSec={division(b)?.periodsSec ?? []} wrestlers={wrestlers} />
          </div>
        ))}
      </div>
    </div>
  );
}

function plannedTime(ev: EventInfo, minutes: number | null): string {
  if (minutes === null || !ev.startTime) return "";
  const [h, m] = ev.startTime.split(":").map(Number) as [number, number];
  const d = new Date(2000, 0, 1, h, m + minutes);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function Sheet({ event, bout, bracket, periodsSec, wrestlers }: { event: EventInfo; bout: Bout; bracket: string; periodsSec: number[]; wrestlers: WrestlerMap }) {
  const ruleset = RULESETS.find((r) => r.id === event.ruleset?.id);
  const colors = ruleset?.cornerColors ?? { A: "red", B: "green" };
  const columns = [...periodsSec.map((_, i) => `P${i + 1}`), ...(ruleset?.style === "folkstyle" ? ["OT"] : []), "Total"];
  const ORDER = ["DEC", "MD", "TF", "FALL", "FOR", "INJ", "DQ", "VPO1", "VSU1", "VFA", "VFO", "VIN", "DSQ"];
  const resultTypes = ORDER.filter((k) => k in (ruleset?.teamPoints ?? {}));
  const person = (id: string | null, from?: string) =>
    id ? (
      <>
        <div className="truncate text-lg font-bold">{wrestlerName(wrestlers, id)}</div>
        <div className="truncate text-sm">{wrestlers.get(id)?.team ?? ""}</div>
      </>
    ) : (
      <>
        <div className="h-7 border-b border-slate-400" />
        <div className="text-xs text-slate-500">{from ?? ""}</div>
      </>
    );
  const planned = plannedTime(event, bout.plannedStartMin);
  return (
    <div className="m-3 rounded-lg border-2 border-slate-900 p-4 break-inside-avoid print:m-0 print:mb-[0.3in] print:h-[4.85in]">
      <div className="flex items-start justify-between gap-4 border-b border-slate-300 pb-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold tracking-wide text-slate-600 uppercase">{event.name}</div>
          <div className="truncate font-bold">
            {bracket} · {bout.label}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-3xl leading-none font-black">#{bout.boutNumber}</div>
          <div className="text-sm font-semibold">
            Mat {bout.mat}
            {planned && <span className="font-normal text-slate-600"> · ~{planned}</span>}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {(["A", "B"] as const).map((c) => (
          <div key={c} className="rounded border-2 border-slate-900 p-2">
            <div className="text-[11px] font-black tracking-wider uppercase">{cap(colors[c])}</div>
            {person(c === "A" ? bout.a : bout.b, c === "A" ? bout.aFrom : bout.bFrom)}
          </div>
        ))}
      </div>

      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="w-20 border border-slate-900 px-2 py-1 text-left" />
            {columns.map((c) => (
              <th key={c} className="border border-slate-900 px-2 py-1 text-center">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(["A", "B"] as const).map((c) => (
            <tr key={c}>
              <td className="border border-slate-900 px-2 py-3 font-bold">{cap(colors[c])}</td>
              {columns.map((col) => (
                <td key={col} className="border border-slate-900" />
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {resultTypes.map((t) => (
          <span key={t} className="whitespace-nowrap">
            ☐ {WIN_TYPE_LABELS[t] ?? t}
          </span>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
        <div>
          Winner: ☐ {cap(colors.A)} ☐ {cap(colors.B)}
        </div>
        <div>Final score: ____ – ____</div>
        <div>Time (fall/TF): ____:____</div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-6 text-sm">
        <div className="border-t border-slate-900 pt-1">Scorer</div>
        <div className="border-t border-slate-900 pt-1">Referee</div>
      </div>
    </div>
  );
}
