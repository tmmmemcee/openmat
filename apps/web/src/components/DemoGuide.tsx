import { useState } from "react";
import { Link } from "react-router";
import type { EventInfo } from "../api";
import { useStartDemo } from "../lib/demo";
import { Button, ErrorBox, cx } from "../ui";

/** Shown to someone trying the live demo: what this is, and things to try. */
export function DemoGuide({ event }: { event: EventInfo }) {
  const [open, setOpen] = useState(true);
  const start = useStartDemo();
  const slug = event.slug;
  const kind = event.format === "madison" ? "youth" : "high-school";
  const tries: { label: string; detail: string; to: string; newTab?: boolean }[] = [
    { label: "Score a match", detail: "Open the Mat 1 scoring table and tap through a bout, then finish it.", to: `/e/${slug}/table/1`, newTab: true },
    { label: "Watch the mats", detail: "The public mat board updates within seconds of a result. Put it next to the table.", to: `/e/${slug}/mats`, newTab: true },
    { label: "Run the day", detail: "In the Live tab, move a bout to another mat or fix a result.", to: `/e/${slug}/manage/live` },
    { label: "Be a parent", detail: "Follow a wrestler or a team and see where they're up next.", to: `/e/${slug}/follow`, newTab: true },
    { label: "Brackets", detail: "Search any name to find their bracket.", to: `/e/${slug}/brackets`, newTab: true },
    ...(event.format === "madison"
      ? [{ label: "Weigh-ins and groups", detail: "Weigh a kid in, then see the groups and drag kids between them.", to: `/e/${slug}/manage/groups` }]
      : [{ label: "Seeds and printouts", detail: "Seed a bracket, then print brackets and bout sheets.", to: `/e/${slug}/manage/brackets` }]),
    { label: "QR codes", detail: "Print a fan poster and scoring table cards.", to: `/e/${slug}/print/qr`, newTab: true },
  ];
  return (
    <div className="border-b border-amber-300 bg-amber-50">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-amber-950">
            <strong>Live demo.</strong> This tournament is yours to play with: nothing is real, nobody else sees your changes, and it's deleted after a day.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? "Hide tips" : "Things to try"}
            </Button>
            <Button size="sm" variant="secondary" disabled={start.isPending} onClick={() => start.mutate(kind)}>
              {start.isPending ? "Setting up…" : "Start over"}
            </Button>
          </div>
        </div>
        <ErrorBox error={start.error} />
        {open && (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {tries.map((t) => (
              <li key={t.label}>
                <Link
                  to={t.to}
                  {...(t.newTab ? { target: "_blank", rel: "noreferrer" } : {})}
                  className={cx("block h-full rounded-lg bg-white p-3 ring-1 ring-amber-200 transition hover:ring-amber-500")}
                >
                  <span className="block text-sm font-bold text-slate-900">
                    {t.label} {t.newTab ? "↗" : "→"}
                  </span>
                  <span className="block text-xs text-slate-600">{t.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
