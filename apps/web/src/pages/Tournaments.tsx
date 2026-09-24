import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { type ListedEvent, api } from "../api";
import { formatDate, formatTime } from "../lib/format";
import { regionName } from "../lib/states";
import { Badge, Card, ErrorBox, Field, Header, Input, Page, Select, Spinner } from "../ui";

/** Public list of upcoming tournaments with filters kept in the URL (shareable). */
export default function Tournaments() {
  const [params, setParams] = useSearchParams();
  // Filters live in state so inputs respond instantly; the URL mirrors them so a filtered list can be shared.
  const [filters, setFilters] = useState(() => ({
    q: params.get("q") ?? "",
    state: params.get("state") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    format: params.get("format") ?? "",
    open: params.get("open") ?? "",
  }));
  const set = (key: keyof typeof filters, value: string) => setFilters((f) => ({ ...f, [key]: value }));
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const [debouncedQs, setDebouncedQs] = useState(qs);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQs(qs);
      setParams(new URLSearchParams(qs), { replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [qs, setParams]);
  const list = useQuery({
    queryKey: ["tournaments", debouncedQs],
    queryFn: () => api<{ events: ListedEvent[]; states: string[] }>(`/events${debouncedQs ? `?${debouncedQs}` : ""}`),
    placeholderData: (prev) => prev,
  });
  const anyFilter = Object.values(filters).some(Boolean);

  return (
    <>
      <Header title="Find a tournament" subtitle="Upcoming wrestling tournaments" />
      <Page className="space-y-4">
        <Card>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="sm:col-span-2">
              <Field label="Search">
                <Input placeholder="Name, city or venue" value={filters.q} onChange={(e) => set("q", e.target.value)} />
              </Field>
            </div>
            <Field label="State">
              <Select value={filters.state} onChange={(e) => set("state", e.target.value)}>
                <option value="">Anywhere</option>
                {(list.data?.states ?? []).map((s) => (
                  <option key={s} value={s}>
                    {regionName(s)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From">
              <Input type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} />
            </Field>
            <Field label="Type">
              <Select value={filters.format} onChange={(e) => set("format", e.target.value)}>
                <option value="">All</option>
                <option value="madison">Youth (grouped by weight)</option>
                <option value="weight-classes">Weight classes</option>
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={filters.open === "true"} onChange={(e) => set("open", e.target.checked ? "true" : "")} />
              Registration open now
            </label>
            {anyFilter && (
              <button type="button" className="text-sm font-semibold text-brand-700" onClick={() => setFilters({ q: "", state: "", from: "", to: "", format: "", open: "" })}>
                Clear filters
              </button>
            )}
          </div>
        </Card>

        <ErrorBox error={list.error} />
        {list.isLoading ? (
          <Spinner />
        ) : list.data?.events.length === 0 ? (
          <Card className="text-center text-slate-600">
            {anyFilter ? "No tournaments match. Try fewer filters." : "No upcoming tournaments listed yet."}
          </Card>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {list.data?.events.map((e) => (
              <li key={e.slug}>
                <Link to={`/e/${e.slug}`} className="block h-full rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:ring-brand-600">
                  <div className="flex items-start gap-4">
                    <DateTile iso={e.startDate} />
                    <div className="min-w-0 flex-1">
                      <h2 className="font-bold text-slate-900">{e.name}</h2>
                      <p className="text-sm text-slate-600">
                        {[formatDate(e.startDate), formatTime(e.startTime)].filter(Boolean).join(" · ")}
                      </p>
                      <p className="truncate text-sm text-slate-600">{[e.location, [e.city, e.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {e.registrationOpen && <Badge tone="green">Registration open</Badge>}
                        <Badge tone="gray">{e.format === "madison" ? "Youth groups" : "Weight classes"}</Badge>
                        {e.wrestlers > 0 && <Badge tone="blue">{e.wrestlers} wrestlers</Badge>}
                      </div>
                      {e.divisions.length > 0 && <p className="mt-2 truncate text-xs text-slate-500">{e.divisions.join(" · ")}</p>}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Page>
    </>
  );
}

function DateTile({ iso }: { iso: string }) {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return (
    <div className="w-14 shrink-0 overflow-hidden rounded-lg text-center ring-1 ring-slate-200">
      <div className="bg-brand-800 py-0.5 text-xs font-bold text-white uppercase">{date.toLocaleDateString(undefined, { month: "short" })}</div>
      <div className="py-1 text-xl font-extrabold">{d}</div>
    </div>
  );
}
