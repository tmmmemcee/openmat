import { useEffect, useState } from "react";
import type { LiveDetails } from "../api";

/**
 * A match clock that keeps ticking between refreshes. `serverNow` corrects for
 * this device's clock being off from the server's.
 */
export function LiveClock({ clock, serverNow, periods }: { clock: NonNullable<LiveDetails["clock"]>; serverNow: string; periods: number }) {
  const [, tick] = useState(0);
  const [offset] = useState(() => new Date(serverNow).getTime() - Date.now());
  useEffect(() => {
    if (!clock.running) return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [clock.running]);
  const elapsed = clock.running ? (Date.now() + offset - new Date(clock.at).getTime()) / 1000 : 0;
  const left = Math.max(0, Math.ceil(clock.remainingSec - elapsed));
  const label = clock.period > periods ? `OT${clock.period - periods > 1 ? ` ${clock.period - periods}` : ""}` : `P${clock.period}`;
  return (
    <span className="tabular-nums">
      {label} {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
      {!clock.running && left > 0 ? " ⏸" : ""}
    </span>
  );
}
