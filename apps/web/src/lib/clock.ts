/**
 * Match clock for the table: counts down each period, remembers where it was
 * if the page reloads, and reports match time elapsed for the score sheet.
 */
import { useCallback, useEffect, useState } from "react";

interface ClockState {
  period: number;
  /** Seconds already run in this period before the current run. */
  elapsed: number;
  /** Date.now() when the clock was started, or null when stopped. */
  runningSince: number | null;
}

const key = (boutId: string) => `openmat:clock:${boutId}`;

function load(boutId: string): ClockState {
  try {
    const raw = localStorage.getItem(key(boutId));
    if (raw) return JSON.parse(raw) as ClockState;
  } catch {
    /* ignore */
  }
  return { period: 1, elapsed: 0, runningSince: null };
}

export function useMatchClock(boutId: string, periodsSec: number[], overtimeSec = 60) {
  const [state, setState] = useState<ClockState>(() => load(boutId));
  const [, tick] = useState(0);
  useEffect(() => {
    try {
      localStorage.setItem(key(boutId), JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [boutId, state]);
  useEffect(() => {
    if (state.runningSince === null) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [state.runningSince]);

  const length = (p: number) => periodsSec[p - 1] ?? overtimeSec;
  const runSeconds = state.elapsed + (state.runningSince ? (Date.now() - state.runningSince) / 1000 : 0);
  const inPeriod = Math.min(runSeconds, length(state.period));
  const remaining = Math.max(0, length(state.period) - inPeriod);
  const before = Array.from({ length: state.period - 1 }, (_, i) => length(i + 1)).reduce((a, b) => a + b, 0);
  const matchTimeSec = Math.floor(before + inPeriod);
  const expired = remaining <= 0;
  const running = state.runningSince !== null && !expired;

  // Stop automatically at the end of the period.
  useEffect(() => {
    if (expired && state.runningSince !== null) setState((s) => ({ ...s, elapsed: length(s.period), runningSince: null }));
  });

  const start = useCallback(() => setState((s) => (s.runningSince ? s : { ...s, runningSince: Date.now() })), []);
  const stop = useCallback(
    () => setState((s) => (s.runningSince ? { ...s, elapsed: s.elapsed + (Date.now() - s.runningSince) / 1000, runningSince: null } : s)),
    [],
  );
  const nextPeriod = useCallback(() => setState((s) => ({ period: s.period + 1, elapsed: 0, runningSince: null })), []);
  const setRemaining = useCallback(
    (sec: number) => setState((s) => ({ ...s, elapsed: Math.max(0, length(s.period) - sec), runningSince: null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [periodsSec],
  );
  const reset = useCallback(() => {
    try {
      localStorage.removeItem(key(boutId));
    } catch {
      /* ignore */
    }
  }, [boutId]);

  return {
    period: state.period,
    overtime: state.period > periodsSec.length,
    remaining,
    matchTimeSec,
    running,
    expired,
    start,
    stop,
    toggle: running ? stop : start,
    nextPeriod,
    setRemaining,
    reset,
  };
}

export const mmss = (sec: number) => {
  const s = Math.ceil(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
