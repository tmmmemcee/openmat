import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { type AllMats, type Bracket, type Entry, type EventInfo, type Group, type MatQueue, type Wrestler, api } from "../api";
import { captureTokenFromHash } from "../token";

/** Event info for this browser's access level. Picks up a token from the link first. */
export function useEvent(slug: string) {
  useEffect(() => captureTokenFromHash(slug), [slug]);
  // Capture synchronously too, so the first request already carries the token.
  captureTokenFromHash(slug);
  return useQuery({ queryKey: ["event", slug], queryFn: () => api<EventInfo>(`/events/${slug}`, { slug }) });
}

export function useEntries(slug: string, enabled = true) {
  return useQuery({
    queryKey: ["entries", slug],
    queryFn: () => api<Entry[]>(`/events/${slug}/entries`, { slug }),
    enabled,
    refetchInterval: 15_000,
  });
}

export function useGroups(slug: string, enabled = true) {
  return useQuery({
    queryKey: ["groups", slug],
    queryFn: () => api<{ groups: Group[]; ungroupedIds: string[] }>(`/events/${slug}/groups`, { slug }),
    enabled,
  });
}

/** A mutation that refreshes event data when it succeeds. */
export function useEventMutation<TVars, TResult = unknown>(slug: string, fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["entries", slug] });
      void qc.invalidateQueries({ queryKey: ["groups", slug] });
      void qc.invalidateQueries({ queryKey: ["event", slug] });
      void qc.invalidateQueries({ queryKey: ["brackets", slug] });
      void qc.invalidateQueries({ queryKey: ["mat", slug] });
    },
  });
}

export function useBrackets(slug: string) {
  return useQuery({
    queryKey: ["brackets", slug],
    queryFn: () => api<{ brackets: Bracket[]; wrestlers: Wrestler[] }>(`/events/${slug}/brackets`, { slug }),
    refetchInterval: 15_000,
  });
}

export function useMatQueue(slug: string, mat: number) {
  return useQuery({
    queryKey: ["mat", slug, mat],
    queryFn: () => api<MatQueue>(`/events/${slug}/mats/${mat}`, { slug }),
    refetchInterval: 5_000,
  });
}

/** Every mat's line in one request, split into per-mat views. */
export function useAllMats(slug: string, refetchInterval = 3_000) {
  return useQuery({
    queryKey: ["mat", slug, "all"],
    queryFn: () => api<AllMats>(`/events/${slug}/mats`, { slug }),
    refetchInterval,
    select: (d): MatQueue[] => d.mats.map((m) => ({ ...m, wrestlers: d.wrestlers, serverNow: d.serverNow })),
  });
}
