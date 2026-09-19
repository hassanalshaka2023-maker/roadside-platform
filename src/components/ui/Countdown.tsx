"use client";

import { useEffect, useState } from "react";

/**
 * Counts down from `seconds` to zero.
 *
 * Seeded from a plain number rather than a timestamp, so nothing impure runs
 * during render. Give it a `key` that changes whenever a new countdown should
 * start - remounting is how it resets.
 *
 * The value is a hint for the user; the server enforces the real cooldown, so
 * a second of drift over a minute does not matter.
 */
export function Countdown({
  seconds,
  children,
  whenDone = null,
}: {
  seconds: number;
  /** Rendered with the remaining seconds while the countdown runs. */
  children: (remaining: number) => React.ReactNode;
  /** Rendered once it reaches zero. */
  whenDone?: React.ReactNode;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (remaining <= 0) return <>{whenDone}</>;
  return <>{children(remaining)}</>;
}
