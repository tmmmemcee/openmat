import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { formatDate, formatTime, periods, place } from "../lib/format";
import { useEvent } from "../lib/hooks";
import { Card, ErrorBox, Header, Notice, Page, Spinner } from "../ui";
import { type EntryDraft, EntryForm } from "./EntryForm";

export default function EventPublic() {
  const { slug = "" } = useParams();
  const event = useEvent(slug);
  const [formKey, setFormKey] = useState(0);
  const [registered, setRegistered] = useState<{ name: string; division: string } | null>(null);
  const register = useMutation({
    mutationFn: (draft: EntryDraft) => api<{ id: string; division: string }>(`/events/${slug}/entries`, { method: "POST", body: draft }),
  });

  if (event.isLoading) return <Spinner />;
  if (!event.data)
    return (
      <Page>
        <ErrorBox error={event.error} />
      </Page>
    );
  const ev = event.data;

  return (
    <>
      <Header
        title={ev.name}
        subtitle={[[formatDate(ev.startDate), formatTime(ev.startTime)].filter(Boolean).join(", "), place(ev)].filter(Boolean).join(" · ")}
      />
      <Page className="max-w-3xl space-y-4">
        {ev.access?.role === "director" && (
          <Notice>
            You're the director. <Link to={`/e/${slug}/manage`} className="font-semibold underline">Manage this tournament →</Link>
          </Notice>
        )}

        {ev.settings.registrationOpen && (
          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold">Register a wrestler</h2>
              <Link to={`/e/${slug}/team`} className="text-sm font-semibold text-brand-700">
                Coach? Register your whole team →
              </Link>
            </div>
            {registered && (
              <div className="mt-3">
                <Notice tone="green">
                  {registered.name} is registered in {registered.division}. See you at weigh-ins! You can register another wrestler below.
                </Notice>
              </div>
            )}
            <div className="mt-3">
              <EntryForm
                key={formKey}
                event={ev}
                askEmail
                submitLabel="Register"
                pending={register.isPending}
                error={register.error}
                onSubmit={(draft) =>
                  register.mutate(draft, {
                    onSuccess: (res) => {
                      setRegistered({ name: `${draft.firstName} ${draft.lastName}`, division: res.division });
                      setFormKey((k) => k + 1);
                    },
                  })
                }
              />
            </div>
          </Card>
        )}

        <Card>
          <h2 className="text-lg font-bold">Divisions</h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {ev.divisions.map((d) => (
              <li key={d.id} className="flex justify-between gap-3 py-2">
                <span className="font-medium">{d.name}</span>
                <span className="text-slate-500">
                  {d.weightClasses ? `${d.weightClasses[0]}–${d.weightClasses[d.weightClasses.length - 1]} lb · ` : ""}periods {periods(d.periodsSec)}
                </span>
              </li>
            ))}
          </ul>
          {ev.format === "madison" && (
            <p className="mt-3 text-sm text-slate-600">
              No fixed weight classes: after weigh-ins, kids are grouped with others their age within about{" "}
              {ev.settings.grouping.maxSpreadPct}% of their weight, usually {ev.settings.grouping.targetSize} to a group.
            </p>
          )}
        </Card>

        {ev.ruleset && (
          <Card>
            <h2 className="text-lg font-bold">Rules: {ev.ruleset.name}</h2>
            <p className="mt-1 text-sm text-slate-600">{ev.ruleset.summary}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {ev.ruleset.links.map((l) => (
                <li key={l.url}>
                  <a href={l.url} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 underline">
                    {l.label} ↗
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">Minimum rest between a wrestler's matches: {ev.settings.restMin} minutes.</p>
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Link to={`/e/${slug}/brackets`} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-brand-600">
            <div className="font-bold">Brackets & results →</div>
            <div className="text-sm text-slate-600">Find your wrestler, see their bracket and results.</div>
          </Link>
          <Link to={`/e/${slug}/mats`} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:ring-brand-600">
            <div className="font-bold">Mats: on deck & in the hole →</div>
            <div className="text-sm text-slate-600">Who's wrestling now on every mat, and who's next.</div>
          </Link>
        </div>
      </Page>
    </>
  );
}
