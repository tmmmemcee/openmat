/**
 * College riding time: who is in control on top, accumulated while the match
 * clock runs. Survives page reloads.
 */
import type { Corner } from "@openmat/core";
import { useCallback, useEffect, useState } from "react";

interface RidingState {
  rider: Corner | null;
  /** Seconds banked for each wrestler. */
  A: number;
  B: number;
  /** Date.now() when the current stretch began (clock running and someone riding). */
  since: number | null;
}

const key = (boutId: string) => `openmat:riding:${boutId}`;

function load(boutId: string): RidingState {
  try {
    const raw = localStorage.getItem(key(boutId));
    if (raw) return JSON.parse(raw) as RidingState;
  } catch {
    /* ignore */
  }
  return { rider: null, A: 0, B: 0, since: null };
}

const bank = (s: RidingState, now: number): RidingState =>
  s.rider && s.since ? { ...s, [s.rider]: s[s.rider] + (now - s.since) / 1000, since: null } : { ...s, since: null };

export function useRidingClock(boutId: string, clockRunning: boolean) {
  const [state, setState] = useState<RidingState>(() => load(boutId));
  const [, tick] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(key(boutId), JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [boutId, state]);

  // Start or stop accumulating with the match clock.
  useEffect(() => {
    setState((s) => {
      const now = Date.now();
      if (clockRunning && s.rider && !s.since) return { ...s, since: now };
      if (!clockRunning && s.since) return bank(s, now);
      return s;
    });
  }, [clockRunning]);

  useEffect(() => {
    if (!state.since) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [state.since]);

  const total = (c: Corner) => state[c] + (state.rider === c && state.since ? (Date.now() - state.since) / 1000 : 0);
  const setRider = useCallback(
    (rider: Corner | null) =>
      setState((s) => {
        const now = Date.now();
        const banked = bank(s, now);
        return { ...banked, rider, since: rider && clockRunning ? now : null };
      }),
    [clockRunning],
  );
  const a = total("A");
  const b = total("B");
  const net = Math.floor(Math.abs(a - b));
  return { rider: state.rider, setRider, advantage: { corner: (a >= b ? "A" : "B") as Corner, seconds: net } };
}
