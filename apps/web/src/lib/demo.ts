import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../api";
import { setToken } from "../token";

/** Make a fresh demo tournament for this visitor and open its director dashboard. */
export function useStartDemo() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (kind: "youth" | "high-school") => api<{ slug: string; directorToken: string }>("/demo", { method: "POST", body: { kind } }),
    onSuccess: ({ slug, directorToken }) => {
      setToken(slug, directorToken);
      navigate(`/e/${slug}/manage`);
    },
  });
}
