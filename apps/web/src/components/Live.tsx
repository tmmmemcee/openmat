import { useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { type LiveDetails, type LiveMap, api } from "../api";
import { cx } from "../ui";
import { LiveClock } from "./LiveClock";

/** Live score/position/clock for bouts in progress, shared with bracket boxes and status cards. */
interface LiveContextValue {
  slug: string;
  live?: LiveMap;
  /** Regulation periods, to label overtime on the clock. */
  periods: number;
}

export const LiveContext = createContext<LiveContextValue | null>(null);

export function useLiveMap(slug: string, enabled = true) {
  return useQuery({
    queryKey: ["live", slug],
    queryFn: () => api<LiveMap>(`/events/${slug}/live`),
    refetchInterval: 3_000,
    enabled,
  });
}

/** The live details for a bout, if it's in progress and a LiveContext is around. */
export function useBoutLive(boutId: string): { live?: LiveDetails; serverNow?: string; slug?: string; periods: number } {
  const ctx = useContext(LiveContext);
  return { live: ctx?.live?.bouts[boutId], serverNow: ctx?.live?.serverNow, slug: ctx?.slug, periods: ctx?.periods ?? 3 };
}

export function positionText(position: LiveDetails["position"], colors = { A: "Red", B: "Green" }): string | null {
  if (!position) return null;
  if (position === "neutral") return "Neutral";
  return `${position === "A-top" ? colors.A : colors.B} on top`;
}

/** "LIVE · P2 1:23 · Red on top" */
export function LiveLine({ live, serverNow, periods, className }: { live: LiveDetails; serverNow: string; periods: number; className?: string }) {
  const pos = positionText(live.position);
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-x-1.5", className)}>
      <span className="rounded bg-red-600 px-1.5 text-[10px] font-black tracking-wide text-white">LIVE</span>
      {live.clock && <LiveClock clock={live.clock} serverNow={serverNow} periods={periods} />}
      {pos && <span>· {pos}</span>}
    </span>
  );
}
