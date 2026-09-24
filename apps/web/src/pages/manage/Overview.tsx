import { type EventInfo, api } from "../../api";
import { useEntries, useEventMutation } from "../../lib/hooks";
import { periods } from "../../lib/format";
import { staffUrl } from "../../token";
import { Badge, Button, Card, CopyButton, ErrorBox } from "../../ui";

export default function Overview({ event }: { event: EventInfo }) {
  const entries = useEntries(event.slug);
  const list = entries.data ?? [];
  const weighed = list.filter((e) => e.status === "weighed-in").length;
  const scratched = list.filter((e) => e.status === "scratched").length;
  const update = useEventMutation(event.slug, (settings: Partial<EventInfo["settings"]>) =>
    api(`/events/${event.slug}`, { method: "PATCH", slug: event.slug, body: { settings } }),
  );
  const reset = useEventMutation(event.slug, (linkId: string) =>
    api(`/events/${event.slug}/links/${linkId}/reset`, { method: "POST", slug: event.slug }),
  );
  const publicUrl = `${window.location.origin}/e/${event.slug}`;
  const links = event.staffLinks ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Registered" value={list.length - scratched} />
          <Stat label="Weighed in" value={weighed} />
          <Stat label="Scratched" value={scratched} />
        </div>

        <Card>
          <h2 className="font-bold">Registration</h2>
          <p className="mt-1 text-sm text-slate-600">
            When open, parents and coaches can register wrestlers themselves from the public page.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Badge tone={event.settings.registrationOpen ? "green" : "gray"}>{event.settings.registrationOpen ? "Open" : "Closed"}</Badge>
            <Button
              variant="secondary"
              size="sm"
              disabled={update.isPending}
              onClick={() => update.mutate({ registrationOpen: !event.settings.registrationOpen })}
            >
              {event.settings.registrationOpen ? "Close registration" : "Open registration"}
            </Button>
            <CopyButton text={publicUrl} label="Copy public link" />
          </div>
        </Card>

        <Card>
          <h2 className="font-bold">Staff links</h2>
          <p className="mt-1 text-sm text-slate-600">
            Send each helper their link. It only lets them do their job: the weigh-in link records weights, and each table link scores
            its own mat. If a link gets into the wrong hands, reset it.
          </p>
          <ul className="mt-3 divide-y divide-slate-100">
            {links.map((l) => {
              const path = l.role === "weigh-in" ? "weigh-in" : `table/${l.mat}`;
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="font-medium">{l.role === "weigh-in" ? "Weigh-in station" : `Mat ${l.mat} table`}</span>
                  <span className="flex gap-2">
                    <CopyButton text={staffUrl(event.slug, path, l.token)} label="Copy link" />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => confirm("Make a new link? The old one will stop working.") && reset.mutate(l.id)}
                    >
                      Reset
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
          <ErrorBox error={reset.error ?? update.error} />
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <h2 className="font-bold">Setup</h2>
          <dl className="mt-2 space-y-2 text-sm">
            <Row label="Format">{event.format === "madison" ? "Youth groups by weight" : "Official weight classes"}</Row>
            <Row label="Rules">{event.ruleset?.name}</Row>
            <Row label="Rest between matches">{event.settings.restMin} min</Row>
            <Row label="Mats">
              <span className="inline-flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => update.mutate({ mats: Math.max(1, event.settings.mats - 1) })}>
                  −
                </Button>
                <strong>{event.settings.mats}</strong>
                <Button size="sm" variant="secondary" onClick={() => update.mutate({ mats: event.settings.mats + 1 })}>
                  +
                </Button>
              </span>
            </Row>
          </dl>
        </Card>
        <Card>
          <h2 className="font-bold">Divisions</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {event.divisions.map((d) => (
              <li key={d.id} className="flex justify-between gap-2">
                <span>{d.name}</span>
                <span className="text-slate-500">
                  {list.filter((e) => e.divisionId === d.id && e.status !== "scratched").length} · {periods(d.periodsSec)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-200">
      <div className="text-2xl font-extrabold">{value}</div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}
