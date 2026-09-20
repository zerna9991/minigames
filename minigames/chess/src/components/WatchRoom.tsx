import { useEffect, useMemo, useState } from "react";
import ChessBoard from "./ChessBoard";
import ProfileSidebar from "./ProfileSidebar";
import { useStudent } from "../data/useStudent";
import {
  ApiError,
  buildView,
  getCompletedMatch,
  getOngoingMatch,
  pollMatch,
  watchMatch,
  type CompletedMatch,
  type MatchView,
  type OngoingMatch,
} from "../net/api";

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function resultLabel(c: CompletedMatch): string {
  if (c.result === "draw") return `Draw · ${c.termination.replace(/_/g, " ")}`;
  const winner = c.result === "white" ? c.white_id : c.black_id;
  return `${winner} wins · ${c.termination.replace(/_/g, " ")}`;
}

/** Board to keep on a terminal update: repeat terminal notifications (write
 *  response, then SSE `game_over`) must not wipe the final position. */
function keptView(prev: Phase): MatchView | null {
  return prev.kind === "live" || prev.kind === "over" ? prev.view : null;
}

type Phase =
  | { kind: "loading" }
  | { kind: "live"; ongoing: OngoingMatch; view: MatchView }
  | { kind: "over"; completed: CompletedMatch; view: MatchView | null }
  | { kind: "aborted"; matchId: string }
  | { kind: "error"; message: string };

/** Read-only spectator: `?watch=<match_id>`. Public endpoints + SSE only. */
export default function WatchRoom({ matchId }: { matchId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [streamDown, setStreamDown] = useState(false);
  const [polling, setPolling] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    let unwatch: (() => void) | null = null;
    let unpoll: (() => void) | null = null;

    // `EventSource` never surfaces the HTTP status, so any stream failure
    // (notably the spec's `503` over 200 watchers) degrades to `GET` polling
    // instead of asking the user to reload.
    const startPolling = () => {
      if (cancelled || unpoll) return;
      setPolling(true);
      unpoll = pollMatch(matchId, {
        onSnapshot: (ongoing) => {
          if (!cancelled) applyOngoing(ongoing);
        },
        onMove: (ongoing) => {
          if (!cancelled) applyOngoing(ongoing);
        },
        onGameOver: (completed) => {
          if (cancelled) return;
          setPhase((prev) => ({
            kind: "over",
            completed,
            view: keptView(prev),
          }));
        },
        onAborted: (id) => {
          if (!cancelled) setPhase({ kind: "aborted", matchId: id });
        },
        onError: () => {
          if (!cancelled) setStreamDown(true);
        },
      });
    };

    const applyOngoing = (ongoing: OngoingMatch) => {
      const view = buildView(ongoing);
      if (!view) {
        setPhase({ kind: "error", message: "Server sent a board we can't parse." });
        return;
      }
      setPhase({ kind: "live", ongoing, view });
    };

    (async () => {
      try {
        const ongoing = await getOngoingMatch(matchId);
        if (cancelled) return;
        applyOngoing(ongoing);
      } catch (err) {
        if (cancelled) return;
        // Reads 404 once a match has ended — the result lives under completed.
        if (err instanceof ApiError && err.status === 404) {
          try {
            const completed = await getCompletedMatch(matchId);
            if (cancelled) return;
            setPhase({ kind: "over", completed, view: null });
            return;
          } catch {
            // fall through to the generic error below
          }
        }
        setPhase({
          kind: "error",
          message:
            err instanceof ApiError
              ? `${err.code}: ${err.message}`
              : "Can't reach the chess server.",
        });
        return;
      }
      unwatch = watchMatch(matchId, {
        onSnapshot: (ongoing) => {
          if (!cancelled) applyOngoing(ongoing);
        },
        onMove: (ongoing) => {
          if (!cancelled) applyOngoing(ongoing);
        },
        onGameOver: (completed) => {
          if (cancelled) return;
          setPhase((prev) => ({
            kind: "over",
            completed,
            view: keptView(prev),
          }));
        },
        onAborted: (id) => {
          if (!cancelled) setPhase({ kind: "aborted", matchId: id });
        },
        onError: () => {
          if (cancelled) return;
          setStreamDown(true);
          startPolling();
        },
      });
    })();

    return () => {
      cancelled = true;
      unwatch?.();
      unpoll?.();
    };
  }, [matchId]);

  // Tick the clock estimate while live (server clocks are as-of each event).
  const live = phase.kind === "live" ? phase : null;
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [live !== null, live?.ongoing.ply]); // eslint-disable-line react-hooks/exhaustive-deps

  const clocks = useMemo(() => {
    if (!live) return null;
    const o = live.ongoing;
    const elapsed = Math.max(0, now - Date.parse(o.turn_started_at));
    const white =
      o.turn === "white" ? o.white_clock_ms - elapsed : o.white_clock_ms;
    const black =
      o.turn === "black" ? o.black_clock_ms - elapsed : o.black_clock_ms;
    return { white, black };
  }, [live, live?.ongoing.ply, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const whiteStudent = useStudent(
    live?.ongoing.white_id ??
      (phase.kind === "over" ? phase.completed.white_id : "…"),
  );
  const blackStudent = useStudent(
    live?.ongoing.black_id ??
      (phase.kind === "over" ? phase.completed.black_id : "…"),
  );

  const turn = live?.view.game.turn ?? null;
  const view =
    phase.kind === "live"
      ? phase.view
      : phase.kind === "over"
        ? phase.view
        : null;

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark">♞</span> ACT Chess · Spectating {matchId}
        </span>
      </header>
      <div className="room-body">
        <ProfileSidebar
          top={{
            key: "black",
            tag: `Black${clocks ? ` · ${formatClock(clocks.black)}` : ""}`,
            firstName: blackStudent.firstName,
            lastName: blackStudent.lastName,
            faculty: blackStudent.faculty,
            group: blackStudent.group,
            photo: blackStudent.photo ?? null,
            colorLabel: "Black",
            ready: undefined,
            isTurn: turn === "b",
          }}
          bottom={{
            key: "white",
            tag: `White${clocks ? ` · ${formatClock(clocks.white)}` : ""}`,
            firstName: whiteStudent.firstName,
            lastName: whiteStudent.lastName,
            faculty: whiteStudent.faculty,
            group: whiteStudent.group,
            photo: whiteStudent.photo ?? null,
            colorLabel: "White",
            ready: undefined,
            isTurn: turn === "w",
          }}
        />
        <main className="room-main">
          {phase.kind === "loading" && (
            <p className="muted">Loading match {matchId}…</p>
          )}
          {phase.kind === "error" && (
            <div className="modal">
              <h3>Can't watch this match</h3>
              <p className="muted">{phase.message}</p>
              <p className="hint">
                Tip: open <code>?watch=&lt;match_id&gt;</code> with a match ID
                from <code>GET /api/v1/matches/ongoing</code>.
              </p>
            </div>
          )}
          {phase.kind === "aborted" && (
            <div className="modal">
              <h3>Match aborted</h3>
              <p className="muted">
                {phase.matchId} ended before both sides moved — no result, no
                points.
              </p>
            </div>
          )}
          {view && (
            <ChessBoard
              game={view.game}
              history={view.history}
              lastMove={view.lastMove}
              locked
              lockLabel={
                phase.kind === "over"
                  ? resultLabel(phase.completed)
                  : "Spectating · live"
              }
              myColor={null}
              onMove={() => {}}
              sidePanel={
                (streamDown && phase.kind === "live") || phase.kind === "over" ? (
                  <>
                    {streamDown && phase.kind === "live" && (
                      <p className="hint">
                        {polling
                          ? "Live stream busy — polling the server every few seconds."
                          : "Live stream interrupted — showing the last snapshot. Reload to reconnect."}
                      </p>
                    )}
                    {phase.kind === "over" && (
                      <p className="hint">
                        Final: {resultLabel(phase.completed)}
                        {phase.completed.settlement_state
                          ? ` · points ${phase.completed.settlement_state}`
                          : ""}
                      </p>
                    )}
                  </>
                ) : undefined
              }
            />
          )}
          {phase.kind === "over" && !phase.view && (
            <div className="modal">
              <h3>{resultLabel(phase.completed)}</h3>
              <p className="muted">
                {phase.completed.white_id} (White) vs{" "}
                {phase.completed.black_id} (Black) · {phase.completed.ply} plies
                {phase.completed.settlement_state
                  ? ` · points ${phase.completed.settlement_state}`
                  : ""}
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
