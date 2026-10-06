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

interface MeetScores {
  kind: "meet";
  teams: { team: string; points: number; wins: number; losses: number }[];
  duals: { teams: [string, string]; points: [number, number]; bouts: number }[];
}

const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function TeamScores() {
  const { slug = "" } = useParams();
  const event = useEvent(slug);
  const scores = useQuery({ queryKey: ["team-scores", slug], queryFn: () => api<TeamScore[] | MeetScores>(`/events/${slug}/team-scores`), refetchInterval: 20_000 });
  if (event.isLoading || scores.isLoading) return <Spinner />;
  if (!event.data || !scores.data) return <ErrorBox error={event.error ?? scores.error} />;
  if (!Array.isArray(scores.data)) return <MeetScoreboard name={event.data.name} slug={slug} scores={scores.data} />;
  const list = scores.data;
  return (
    <>
      <Header title={event.data.name} subtitle="Team scores" />
      <Page className="max-w-3xl space-y-4">
        <Link to={`/e/${slug}`} className="text-sm font-semibold text-brand-700">
          ← Tournament
        </Link>
        {list.length === 0 ? (
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
                {list.map((t, i) => {
                  const rank = list.findIndex((x) => x.points === t.points) + 1;
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

/** Dual / tri-meet scores: team totals, and the score of each team-vs-team dual. */
function MeetScoreboard({ name, slug, scores }: { name: string; slug: string; scores: MeetScores }) {
  return (
    <>
      <Header title={name} subtitle="Meet score" />
      <Page className="max-w-3xl space-y-4">
        <Link to={`/e/${slug}`} className="text-sm font-semibold text-brand-700">
          ← Meet
        </Link>
        {scores.teams.length === 0 ? (
          <Notice tone="gray">No results yet. The score adds up as matches finish.</Notice>
        ) : (
          <>
            {scores.duals.map((d) => (
              <Card key={d.teams.join()} className="flex items-center justify-between gap-4">
                {d.teams.map((t, i) => (
                  <div key={t} className={cx("min-w-0 flex-1", i === 1 && "text-right")}>
                    <div className="truncate font-semibold">{t}</div>
                    <div className={cx("text-4xl font-black tabular-nums", d.points[i]! > d.points[1 - i]! ? "text-brand-800" : "text-slate-500")}>{pts(d.points[i]!)}</div>
                  </div>
                ))}
              </Card>
            ))}
            {scores.duals.length > 1 && (
              <Card className="overflow-x-auto p-0 sm:p-0">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                    <tr>
                      <th className="px-4 py-2.5">Team</th>
                      <th className="px-4 py-2.5 text-right">Points</th>
                      <th className="px-4 py-2.5 text-right">Won–lost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {scores.teams.map((t) => (
                      <tr key={t.team}>
                        <td className="px-4 py-2.5 font-medium">{t.team}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{pts(t.points)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">
                          {t.wins}–{t.losses}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}
        <p className="text-xs text-slate-500">Each win scores the team points for how it was won (for example decision 3, major 4, tech fall 5, fall 6).</p>
      </Page>
    </>
  );
}
