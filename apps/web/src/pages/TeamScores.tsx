import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { useEvent } from "../lib/hooks";
import { Card, ErrorBox, Header, Notice, Page, Spinner, cx } from "../ui";

interface TeamScore {
  team: string;
  points: number;
  advancement: number;
  bonus: number;
  placement: number;
  wrestlers: number;
}

const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function TeamScores() {
  const { slug = "" } = useParams();
  const event = useEvent(slug);
  const scores = useQuery({ queryKey: ["team-scores", slug], queryFn: () => api<TeamScore[]>(`/events/${slug}/team-scores`), refetchInterval: 20_000 });
  if (event.isLoading || scores.isLoading) return <Spinner />;
  if (!event.data || !scores.data) return <ErrorBox error={event.error ?? scores.error} />;
  return (
    <>
      <Header title={event.data.name} subtitle="Team scores" />
      <Page className="max-w-3xl space-y-4">
        <Link to={`/e/${slug}`} className="text-sm font-semibold text-brand-700">
          ← Tournament
        </Link>
        {scores.data.length === 0 ? (
          <Notice tone="gray">No team points yet. They add up as results come in.</Notice>
        ) : (
          <Card className="overflow-x-auto p-0 sm:p-0">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">#</th>
                  <th className="px-4 py-2.5">Team</th>
                  <th className="px-4 py-2.5 text-right">Points</th>
                  <th className="hidden px-4 py-2.5 text-right sm:table-cell">Advancement</th>
                  <th className="hidden px-4 py-2.5 text-right sm:table-cell">Bonus</th>
                  <th className="hidden px-4 py-2.5 text-right sm:table-cell">Placement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {scores.data.map((t, i) => {
                  const rank = scores.data.findIndex((x) => x.points === t.points) + 1;
                  return (
                    <tr key={t.team} className={cx(i < 3 && "font-semibold")}>
                      <td className="px-4 py-2.5 text-slate-500">{rank}</td>
                      <td className="px-4 py-2.5">
                        {t.team}
                        <span className="ml-2 text-xs font-normal text-slate-500">{t.wrestlers} scoring</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-base tabular-nums">{pts(t.points)}</td>
                      <td className="hidden px-4 py-2.5 text-right text-slate-600 tabular-nums sm:table-cell">{pts(t.advancement)}</td>
                      <td className="hidden px-4 py-2.5 text-right text-slate-600 tabular-nums sm:table-cell">{pts(t.bonus)}</td>
                      <td className="hidden px-4 py-2.5 text-right text-slate-600 tabular-nums sm:table-cell">{pts(t.placement)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
        <p className="text-xs text-slate-500">
          Scoring: 2 points per championship win and 1 per consolation win; bonus 2 for a fall, forfeit, default or DQ, 1.5 for a tech fall, 1 for a major;
          placement 16, 12, 9, 7, 5, 3, 2, 1 for 1st through 8th.
        </p>
      </Page>
    </>
  );
}
