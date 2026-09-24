import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { disableAlerts, enableAlerts, follow, isIOS, isStandalone, pushSubscription, pushSupported, unfollow, useFollowing } from "../lib/follow";
import { useEvent } from "../lib/hooks";
import { Badge, Button, Card, Dialog, ErrorBox, Field, Header, Input, Notice, Page, Spinner, cx } from "../ui";

interface RosterRow {
  id: string;
  firstName: string;
  lastName: string;
  team: string;
  division: string;
}

interface Status {
  id: string;
  name: string;
  team: string;
  scratched: boolean;
  bracket: { id: string; name: string } | null;
  next: { boutNumber: string | null; mat: number | null; status: string; position: string | null; estimatedStart: string | null; opponent: string } | null;
  results: { boutNumber: string | null; won: boolean; summary: string; opponent: string }[];
  place: number | null;
}

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");

/** "My wrestlers": follow kids or a team, see where they stand, get alerts. */
export default function Follow() {
  const { slug = "" } = useParams();
  const event = useEvent(slug);
  const following = useFollowing(slug);
  const roster = useQuery({ queryKey: ["roster", slug], queryFn: () => api<RosterRow[]>(`/events/${slug}/roster`) });
  const [query, setQuery] = useState("");
  const [alertsOpen, setAlertsOpen] = useState(false);
  const teamMembers = useMemo(
    () => (roster.data ?? []).filter((r) => following.teams.some((t) => t.toLowerCase() === r.team.toLowerCase())).map((r) => r.id),
    [roster.data, following.teams],
  );
  const ids = [...new Set([...following.wrestlers, ...teamMembers])];
  const status = useQuery({
    queryKey: ["status", slug, ids.join(",")],
    queryFn: () => api<Status[]>(`/events/${slug}/wrestler-status`, { method: "POST", body: { ids } }),
    enabled: ids.length > 0,
    refetchInterval: 10_000,
  });
  const change = useMutation({ mutationFn: (fn: () => Promise<void>) => fn() });

  if (event.isLoading) return <Spinner />;
  if (!event.data) return <ErrorBox error={event.error} />;

  const q = query.trim().toLowerCase();
  const matches = q ? (roster.data ?? []).filter((r) => `${r.firstName} ${r.lastName} ${r.team}`.toLowerCase().includes(q)).slice(0, 10) : [];
  const teams = q ? [...new Set((roster.data ?? []).map((r) => r.team).filter((t) => t && t.toLowerCase().includes(q)))].slice(0, 3) : [];

  return (
    <>
      <Header title={event.data.name} subtitle="My wrestlers" />
      <Page className="max-w-3xl space-y-4">
        <div className="flex flex-wrap gap-3 text-sm font-semibold">
          <Link to={`/e/${slug}`} className="text-brand-700">
            ← Tournament
          </Link>
          <Link to={`/e/${slug}/mats`} className="text-brand-700">
            Mats
          </Link>
          <Link to={`/e/${slug}/brackets`} className="text-brand-700">
            Brackets
          </Link>
        </div>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold">Alerts</h2>
              <p className="text-sm text-slate-600">
                {following.alerts
                  ? following.alerts.channel === "push"
                    ? "On: alerts on this device when your wrestlers are in the hole, on deck, and when they finish."
                    : `On: emails to ${following.alerts.email}.`
                  : "Get a heads-up when your wrestlers are in the hole, on deck, and when they finish."}
              </p>
            </div>
            {following.alerts ? (
              <Button variant="secondary" onClick={() => change.mutate(() => disableAlerts(slug))}>
                Turn off
              </Button>
            ) : (
              <Button onClick={() => setAlertsOpen(true)} disabled={!ids.length && !following.teams.length}>
                🔔 Turn on alerts
              </Button>
            )}
          </div>
          <ErrorBox error={change.error} />
        </Card>

        <Card>
          <Field label="Follow a wrestler or team">
            <Input placeholder="Type a name or team…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </Field>
          {(matches.length > 0 || teams.length > 0) && (
            <ul className="mt-2 divide-y divide-slate-100">
              {teams.map((t) => (
                <li key={`t:${t}`} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{t}</span> <span className="text-sm text-slate-500">· whole team</span>
                  </span>
                  <FollowButton on={following.teams.includes(t)} onToggle={() => change.mutate(() => (following.teams.includes(t) ? unfollow(slug, { team: t }) : follow(slug, { team: t })))} />
                </li>
              ))}
              {matches.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">
                      {r.firstName} {r.lastName}
                    </span>{" "}
                    <span className="text-sm text-slate-500">
                      {r.team} · {r.division}
                    </span>
                  </span>
                  <FollowButton
                    on={following.wrestlers.includes(r.id)}
                    onToggle={() => change.mutate(() => (following.wrestlers.includes(r.id) ? unfollow(slug, { wrestler: r.id }) : follow(slug, { wrestler: r.id })))}
                  />
                </li>
              ))}
            </ul>
          )}
          {following.teams.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {following.teams.map((t) => (
                <button key={t} type="button" onClick={() => change.mutate(() => unfollow(slug, { team: t }))} className="rounded-full bg-brand-100 px-3 py-1 text-sm font-semibold text-brand-800">
                  {t} ✕
                </button>
              ))}
            </div>
          )}
        </Card>

        {ids.length === 0 ? (
          <Notice tone="gray">Search above and tap Follow. We'll show where each wrestler is up next, right here.</Notice>
        ) : (
          <ul className="space-y-3">
            {(status.data ?? []).map((s) => (
              <StatusCard key={s.id} s={s} slug={slug} onUnfollow={following.wrestlers.includes(s.id) ? () => change.mutate(() => unfollow(slug, { wrestler: s.id })) : undefined} />
            ))}
          </ul>
        )}
      </Page>
      <AlertsDialog slug={slug} open={alertsOpen} onClose={() => setAlertsOpen(false)} />
    </>
  );
}

function FollowButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <Button size="sm" variant={on ? "secondary" : "primary"} onClick={onToggle}>
      {on ? "Following ✓" : "Follow"}
    </Button>
  );
}

function StatusCard({ s, slug, onUnfollow }: { s: Status; slug: string; onUnfollow?: () => void }) {
  const n = s.next;
  const tone = n?.position === "wrestling" ? "bg-red-600 text-white" : n?.position === "on-deck" ? "bg-amber-400" : n?.position === "in-the-hole" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700";
  const label = n?.position === "wrestling" ? "Wrestling now" : n?.position === "on-deck" ? "On deck" : n?.position === "in-the-hole" ? "In the hole" : null;
  return (
    <li className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-lg font-bold">{s.name}</div>
          <div className="text-sm text-slate-500">
            {s.team}
            {s.bracket && (
              <>
                {" · "}
                <Link to={`/e/${slug}/brackets?b=${s.bracket.id}&w=${s.id}`} className="font-semibold text-brand-700">
                  {s.bracket.name}
                </Link>
              </>
            )}
          </div>
        </div>
        {onUnfollow && (
          <button type="button" onClick={onUnfollow} className="text-xs font-semibold text-slate-400 hover:text-slate-600">
            Unfollow
          </button>
        )}
      </div>
      {s.scratched ? (
        <p className="mt-2 text-sm text-slate-500">Scratched.</p>
      ) : n ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {label && <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-bold", tone)}>{label}</span>}
          <span className="font-semibold">
            {n.mat ? `Mat ${n.mat}` : "Mat TBD"}
            {n.boutNumber ? ` · Bout ${n.boutNumber}` : ""}
          </span>
          <span className="text-sm text-slate-600">vs {n.opponent}</span>
          {n.estimatedStart && n.position !== "wrestling" && <span className="text-sm text-slate-500">· ~{time(n.estimatedStart)}</span>}
        </div>
      ) : s.place ? (
        <p className="mt-2">
          <Badge tone="amber">Finished {s.place}
            {s.place === 1 ? "st" : s.place === 2 ? "nd" : s.place === 3 ? "rd" : "th"}
          </Badge>
        </p>
      ) : s.bracket ? (
        <p className="mt-2 text-sm text-slate-500">No more matches scheduled.</p>
      ) : (
        <p className="mt-2 text-sm text-slate-500">Brackets aren't out yet.</p>
      )}
      {s.results.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm">
          {s.results.map((r, i) => (
            <li key={i} className={r.won ? "text-emerald-700" : "text-slate-500"}>
              {r.won ? "W" : "L"} {r.summary} {r.won ? "over" : "to"} {r.opponent}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function AlertsDialog({ slug, open, onClose }: { slug: string; open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const turnOn = useMutation({
    mutationFn: async (channel: "push" | "email") => {
      if (channel === "push") await enableAlerts(slug, { channel: "push", subscription: await pushSubscription() });
      else await enableAlerts(slug, { channel: "email", email });
    },
    onSuccess: onClose,
  });
  const iosNeedsInstall = isIOS() && !isStandalone();
  return (
    <Dialog open={open} onClose={onClose} title="Turn on alerts">
      <div className="space-y-4">
        {iosNeedsInstall ? (
          <Notice tone="amber">
            On iPhone and iPad, alerts work after you add OpenMat to your home screen: tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, open it from
            there, and come back to this page. Or use email alerts below.
          </Notice>
        ) : pushSupported() ? (
          <div>
            <Button size="lg" className="w-full" disabled={turnOn.isPending} onClick={() => turnOn.mutate("push")}>
              🔔 Alerts on this device
            </Button>
            <p className="mt-1 text-center text-xs text-slate-500">Your browser will ask to allow notifications.</p>
          </div>
        ) : null}
        <div className="border-t border-slate-100 pt-4">
          <Field label="Or get emails instead">
            <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button className="mt-2" variant="secondary" disabled={!/^\S+@\S+\.\S+$/.test(email) || turnOn.isPending} onClick={() => turnOn.mutate("email")}>
            Email me alerts
          </Button>
        </div>
        <ErrorBox error={turnOn.error} />
      </div>
    </Dialog>
  );
}
