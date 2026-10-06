import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../api";
import { setToken } from "../token";
import { setTeamToken } from "./teamToken";

export type DemoKind = "youth" | "high-school" | "meet";

const coachKey = (slug: string) => `openmat:demo-coach:${slug}`;

/** The demo's sample coach team (saved roster), if this browser made the demo. */
export function demoCoachTeam(slug: string): string | null {
  try {
    return localStorage.getItem(coachKey(slug));
  } catch {
    return null;
  }
}

/** Make a fresh demo tournament for this visitor and open its director dashboard. */
export function useStartDemo() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (kind: DemoKind) =>
      api<{ slug: string; directorToken: string; coach?: { teamId: string; token: string } }>("/demo", { method: "POST", body: { kind } }),
    onSuccess: ({ slug, directorToken, coach }) => {
      setToken(slug, directorToken);
      if (coach) {
        setTeamToken(coach.teamId, coach.token);
        try {
          localStorage.setItem(coachKey(slug), coach.teamId);
        } catch {
          /* the coach tip just won't show */
        }
      }
      navigate(`/e/${slug}/manage`);
    },
  });
}
