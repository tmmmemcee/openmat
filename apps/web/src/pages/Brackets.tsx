import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { BracketView } from "../components/BracketView";
import { useBrackets, useEvent } from "../lib/hooks";
import { Card, ErrorBox, Header, Input, Notice, Page, Select, Spinner, cx } from "../ui";

export default function Brackets() {
  const { slug = "" } = useParams();
  const event = useEvent(slug);
  const data = useBrackets(slug);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const wrestlers = useMemo(() => new Map((data.data?.wrestlers ?? []).map((w) => [w.id, w])), [data.data]);

  if (event.isLoading || data.isLoading) return <Spinner />;
  if (!event.data || !data.data) return <ErrorBox error={event.error ?? data.error} />;
  const brackets = data.data.brackets;
  const selectedId = params.get("b") ?? brackets[0]?.id;
  const selected = brackets.find((b) => b.id === selectedId);
  const highlight = params.get("w");

  const q = query.trim().toLowerCase();
  const matches = q
    ? [...wrestlers.values()].filter((w) => `${w.firstName} ${w.lastName} ${w.team}`.toLowerCase().includes(q)).slice(0, 8)
    : [];
  const bracketOf = (id: string) => brackets.find((b) => b.draw.includes(id));

  return (
    <>
      <Header title={event.data.name} subtitle="Brackets" />
      <Page className="space-y-4">
        <div className="flex flex-wrap gap-3 text-sm font-semibold">
          <Link to={`/e/${slug}`} className="text-brand-700">
            ← Tournament
          </Link>
          <Link to={`/e/${slug}/mats`} className="text-brand-700">
            Mat schedule →
          </Link>
        </div>
        {brackets.length === 0 ? (
          <Notice tone="gray">Brackets aren't out yet. They're usually posted after weigh-ins.</Notice>
        ) : (
          <>
            <Card>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="relative">
                  <Input placeholder="Find a wrestler…" value={query} onChange={(e) => setQuery(e.target.value)} />
                  {matches.length > 0 && (
                    <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-slate-200">
                      {matches.map((w) => (
                        <li key={w.id}>
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                            onClick={() => {
                              const b = bracketOf(w.id);
                              if (b) setParams({ b: b.id, w: w.id });
                              setQuery("");
                            }}
                          >
                            <span className="font-medium">
                              {w.firstName} {w.lastName}
                            </span>{" "}
                            <span className="text-slate-500">
                              {w.team} · {bracketOf(w.id)?.name}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <Select value={selectedId} onChange={(e) => setParams({ b: e.target.value })}>
                  {brackets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </div>
            </Card>
            {selected && (
              <Card>
                <h2 className={cx("mb-3 text-xl font-bold")}>{selected.name}</h2>
                <BracketView bracket={selected} wrestlers={wrestlers} highlight={highlight} />
              </Card>
            )}
          </>
        )}
      </Page>
    </>
  );
}
