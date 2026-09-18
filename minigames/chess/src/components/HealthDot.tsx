import { useEffect, useState } from "react";
import { getHealth } from "../net/api";

type Health = "checking" | "up" | "down";

const DOT: Record<Health, string> = {
  checking: "#9aa3a7",
  up: "#acfa00",
  down: "#f90124",
};

/**
 * Liveness dot for the chess backend (`GET /health`, public).
 * Polls on mount + every 30 s; never blocks the page on failure.
 */
export default function HealthDot() {
  const [health, setHealth] = useState<Health>("checking");

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    async function probe() {
      try {
        await getHealth();
        if (!cancelled) setHealth("up");
      } catch {
        if (!cancelled) setHealth("down");
      }
    }
    void probe();
    timer = window.setInterval(() => void probe(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const label =
    health === "up"
      ? "Chess server reachable"
      : health === "down"
        ? "Chess server unreachable"
        : "Checking chess server…";

  return (
    <span
      className="badge"
      title={label}
      aria-label={label}
      style={{ gap: 6 }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: DOT[health],
          display: "inline-block",
        }}
      />
      {health === "up" ? "server up" : health === "down" ? "server down" : "checking…"}
    </span>
  );
}
