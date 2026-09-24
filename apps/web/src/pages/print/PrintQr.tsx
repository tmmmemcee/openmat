import { useState } from "react";
import { Link, useParams } from "react-router";
import type { EventInfo } from "../../api";
import { QrCode } from "../../components/QrCode";
import { formatDate, formatTime, place } from "../../lib/format";
import { useEvent } from "../../lib/hooks";
import { staffUrl } from "../../token";
import { ErrorBox, Notice, Page, Spinner, cx } from "../../ui";
import { PrintToolbar } from "./PrintToolbar";

type Kind = "fans" | "coaches" | "weighin" | "tables";

/** Printable QR codes: a fan poster, a coach registration poster, and cards for the weigh-in and scoring tables. */
export default function PrintQr() {
  const { slug = "" } = useParams();
  const event = useEvent(slug);
  const [pick, setPick] = useState<Record<Kind, boolean>>({ fans: true, coaches: false, weighin: true, tables: true });
  if (event.isLoading) return <Spinner />;
  if (!event.data) return <ErrorBox error={event.error} />;
  const ev = event.data;
  if (ev.access?.role !== "director") {
    return (
      <Page className="max-w-xl">
        <Notice tone="amber">This page is for the tournament director. Open it from your director link.</Notice>
      </Page>
    );
  }
  const origin = window.location.origin;
  const links = ev.staffLinks ?? [];
  const weighIn = links.find((l) => l.role === "weigh-in");
  const tables = links.filter((l) => l.role === "table").sort((a, b) => (a.mat ?? 0) - (b.mat ?? 0));
  const cards: React.ReactNode[] = [];
  if (pick.weighin && weighIn) cards.push(<StaffCard key="w" ev={ev} title="Weigh-in station" url={staffUrl(slug, "weigh-in", weighIn.token)} what="Scan to record weights." />);
  if (pick.tables) {
    for (const t of tables) {
      cards.push(<StaffCard key={t.id} ev={ev} title={`Mat ${t.mat} scoring table`} url={staffUrl(slug, `table/${t.mat}`, t.token)} what={`Scan to open scoring for mat ${t.mat}.`} />);
    }
  }
  const box = (k: Kind, label: string) => (
    <label className="flex items-center gap-1.5 text-sm">
      <input type="checkbox" className="size-4" checked={pick[k]} onChange={(e) => setPick({ ...pick, [k]: e.target.checked })} />
      {label}
    </label>
  );

  return (
    <div className="bg-white">
      <style>{"@page { size: letter portrait; margin: 0.4in; }"}</style>
      <PrintToolbar title={`QR codes · ${ev.name}`} count="Posters print one per page; staff cards two per page.">
        {box("fans", "Fan poster")}
        {box("coaches", "Coach registration poster")}
        {box("weighin", "Weigh-in card")}
        {box("tables", `Table cards (${tables.length})`)}
      </PrintToolbar>
      <div className="mx-auto max-w-[7.7in] print:max-w-none">
        {(pick.weighin || pick.tables) && (
          <div className="m-3 print:hidden">
            <Notice tone="amber">
              Weigh-in and table cards open staff tools without a password. Keep them at the station, and collect them at the end of the day. If one goes
              missing, press <strong>Reset</strong> next to that link on the{" "}
              <Link to={`/e/${slug}/manage`} className="font-semibold underline">
                Overview
              </Link>{" "}
              and print a new card; the old one stops working.
            </Notice>
          </div>
        )}
        {pick.fans && (
          <Poster
            ev={ev}
            url={`${origin}/e/${slug}/follow`}
            heading="Follow your wrestler"
            lines={["Brackets and results", "Who's on deck on every mat", "Alerts when your wrestler is up next"]}
            footer="No app or account needed. Scan with your phone's camera."
          />
        )}
        {pick.coaches && (
          <Poster
            ev={ev}
            url={`${origin}/e/${slug}/team`}
            heading="Coaches: register your team"
            lines={["Paste your roster from a spreadsheet", "Fix anything before you send", "Everyone registered in one go"]}
            footer={ev.settings.registrationOpen ? "Registration is open." : "Registration opens when the director turns it on."}
          />
        )}
        {cards.map((c, i) => (
          <div key={i} className={cx(i % 2 === 1 && "break-after-page")}>
            {c}
          </div>
        ))}
      </div>
    </div>
  );
}

function Poster({ ev, url, heading, lines, footer }: { ev: EventInfo; url: string; heading: string; lines: string[]; footer: string }) {
  return (
    <section className="m-3 flex flex-col items-center gap-5 rounded-2xl border-4 border-slate-900 p-8 text-center break-after-page print:m-0 print:h-[10in] print:justify-center">
      <div className="text-sm font-bold tracking-[0.2em] text-slate-600 uppercase">{ev.name}</div>
      <div className="text-slate-600">
        {[formatDate(ev.startDate), formatTime(ev.startTime), place(ev)].filter(Boolean).join(" · ")}
      </div>
      <h1 className="text-5xl leading-tight font-black">{heading}</h1>
      <QrCode text={url} className="w-[4.2in] max-w-full" />
      <ul className="space-y-1 text-xl font-semibold">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="text-slate-600">{footer}</p>
      <p className="font-mono text-xs break-all text-slate-500">{url}</p>
    </section>
  );
}

function StaffCard({ ev, title, url, what }: { ev: EventInfo; title: string; url: string; what: string }) {
  return (
    <section className="m-3 flex items-center gap-6 rounded-2xl border-4 border-slate-900 p-6 break-inside-avoid print:m-0 print:mb-[0.3in] print:h-[4.8in]">
      <QrCode text={url} className="w-[3.2in] max-w-[45%] shrink-0" />
      <div className="min-w-0 space-y-3">
        <div className="text-xs font-bold tracking-[0.2em] text-slate-600 uppercase">{ev.name}</div>
        <h2 className="text-3xl leading-tight font-black">{title}</h2>
        <p className="text-lg">{what}</p>
        <p className="rounded-lg border-2 border-slate-900 px-3 py-2 text-sm font-bold">STAFF ONLY · keep this card at the station</p>
      </div>
    </section>
  );
}
