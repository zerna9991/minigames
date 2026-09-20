import { useEffect, useMemo, useState } from "react";
import ChessBoard from "./ChessBoard";
import ProfileSidebar, { type SideProfile } from "./ProfileSidebar";
import { useStudent } from "../data/useStudent";
import {
  ApiError,
  buildView,
  getCompletedMatch,
  getOngoingMatch,
  issueGameSession,
  moveToUci,
  playMove,
  pollMatch,
  watchMatch,
  type CompletedMatch,
  type MatchOutcome,
  type MatchView,
  type OngoingMatch,
  type PlayerIdentity,
} from "../net/api";
import {
  identityError,
  isValidIdentity,
  loadIdentity,
  saveIdentity,
} from "../net/identity";
import IdentityFields from "./IdentityFields";
import type { Move } from "../chess/engine";

function sessionKey(matchId: string): string {
  return `act-chess-game-${matchId}`;
}

interface StoredSession {
  token: string;
  side: string;
  studentId: string;
}

function loadStoredSession(matchId: string): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(matchId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token !== "string" || !parsed.token) return null;
    return {
      token: parsed.token,
      side: typeof parsed.side === "string" ? parsed.side : "",
      studentId: typeof parsed.studentId === "string" ? parsed.studentId : "",
    };
  } catch {
    return null;
  }
}

function saveStoredSession(matchId: string, s: StoredSession): void {
  try {
    sessionStorage.setItem(sessionKey(matchId), JSON.stringify(s));
  } catch {
    // storage unavailable — token still works for this page load
  }
}

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

function friendlyWriteError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) {
      // Timeout claimed too early, e.g. "black still has 562258 ms left".
      const left = /(white|black) still has (\d+) ?ms left/i.exec(e.message);
      if (left) {
        const side = left[1][0].toUpperCase() + left[1].slice(1).toLowerCase();
        return `Too early to claim — ${side} still has ${formatClock(Number(left[2]))} on the clock.`;
      }
      if (e.code === "stale_ply" || /stale/i.test(e.message))
        return "Board moved on — resynced to the latest position, try your move again.";
      if (/turn/i.test(e.message)) return "Not your turn (yet) — wait for the opponent.";
      if (/time/i.test(e.message)) return "Time still remains — timeout claim rejected (409).";
      if (/completed/i.test(e.message)) return "Match already ended — reloading the result.";
      return `conflict: ${e.message}`;
    }
    if (e.status === 400) return `Rejected: ${e.message}`;
    if (e.status === 401) return "Unauthorized — check your identity (401).";
    if (e.status === 403)
      return "Forbidden — this game token isn't yours or you're not a player (403). Re-issue your token.";
    if (e.status === 404) return "Match ended or gone (404) — reloading the result.";
    return `${e.code}: ${e.message}`;
  }
  return "Can't reach the chess server.";
}

/** Board to keep on a terminal update: repeat terminal notifications (write
 *  response, then SSE `game_over`) must not wipe the final position. */
function keptView(prev: Phase): MatchView | null {
  return prev.kind === "live" || prev.kind === "over" ? prev.view : null;
}

type Phase =
  | { kind: "need-token" }
  | { kind: "loading" }
  | { kind: "live"; ongoing: OngoingMatch; view: MatchView }
  | { kind: "over"; completed: CompletedMatch; view: MatchView | null }
  | { kind: "aborted"; matchId: string }
  | { kind: "error"; message: string };

/**
 * Server-authoritative play (steps 3–4): `?play=<match_id>`.
 *
 * Identity (player credentials) + per-match game token (`X-Game-Token`),
 * live board from GET + match SSE, moves via `POST …/moves {uci, ply}`,
 * resign + timeout claim. The server owns the board/clocks/results —
 * this screen never applies a move locally, it renders what the server
 * returns (response envelope or the next SSE event).
 */
export default function PlayRoom({ matchId }: { matchId: string }) {
  const [identity, setIdentity] = useState<PlayerIdentity>(() => loadIdentity());
  const [session, setSession] = useState<StoredSession | null>(() =>
    loadStoredSession(matchId),
  );
  const [phase, setPhase] = useState<Phase>(() =>
    loadStoredSession(matchId) ? { kind: "loading" } : { kind: "need-token" },
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    saveIdentity(identity);
  }, [identity]);

  // A token belongs to one student — drop it when the identity switches.
  useEffect(() => {
    if (session && session.studentId && session.studentId !== identity.studentId) {
      setSession(null);
      try {
        sessionStorage.removeItem(sessionKey(matchId));
      } catch {
        // ignore
      }
      setPhase({ kind: "need-token" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.studentId]);

  async function onIssueToken() {
    const err = identityError(identity);
    if (err) {
      setNotice(err);
      return;
    }
    setNotice(null);
    setSending(true);
    try {
      const s = await issueGameSession(identity, matchId);
      const stored: StoredSession = {
        token: s.token,
        side: s.side,
        studentId: identity.studentId,
      };
      saveStoredSession(matchId, stored);
      setSession(stored);
      setPhase({ kind: "loading" });
    } catch (e) {
      setNotice(friendlyWriteError(e));
    } finally {
      setSending(false);
    }
  }

  // Load + stream once we hold a token.
  useEffect(() => {
    if (!session || phase.kind === "need-token") return;
    let cancelled = false;
    let unwatch: (() => void) | null = null;
    let unpoll: (() => void) | null = null;

    const applyOngoing = (ongoing: OngoingMatch) => {
      const view = buildView(ongoing);
      if (!view) {
        setPhase({ kind: "error", message: "Server sent a board we can't parse." });
        return;
      }
      setPhase({ kind: "live", ongoing, view });
    };

    // `EventSource` never surfaces the HTTP status, so any stream failure
    // (notably the spec's `503` over 200 watchers) degrades to `GET` polling.
    const startPolling = () => {
      if (cancelled || unpoll) return;
      unpoll = pollMatch(
        matchId,
        {
          onSnapshot: (ongoing) => {
            if (!cancelled) applyOngoing(ongoing);
          },
          onMove: (ongoing) => {
            if (!cancelled) {
              applyOngoing(ongoing);
              setNotice(null);
            }
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
            if (!cancelled)
              setNotice("Server unreachable — retrying every few seconds…");
          },
        },
      );
    };

    (async () => {
      try {
        const ongoing = await getOngoingMatch(matchId);
        if (cancelled) return;
        applyOngoing(ongoing);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          try {
            const completed = await getCompletedMatch(matchId);
            if (cancelled) return;
            setPhase({ kind: "over", completed, view: null });
            return;
          } catch {
            // fall through
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
          if (!cancelled) {
            applyOngoing(ongoing);
            setNotice(null);
          }
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
          startPolling();
        },
      });
    })();

    return () => {
      cancelled = true;
      unwatch?.();
      unpoll?.();
    };
    // Reconnect when the token (re-)arrives; identity edits re-issue explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, session?.token]);

  // Tick the clock estimate while live (server clocks are as-of each event).
  const live = phase.kind === "live" ? phase : null;
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live !== null, live?.ongoing.ply]);

  const clocks = useMemo(() => {
    if (!live) return null;
    const o = live.ongoing;
    const elapsed = Math.max(0, now - Date.parse(o.turn_started_at));
    const white = o.turn === "white" ? o.white_clock_ms - elapsed : o.white_clock_ms;
    const black = o.turn === "black" ? o.black_clock_ms - elapsed : o.black_clock_ms;
    return { white, black };
  }, [live, live?.ongoing.ply, now]); // eslint-disable-line react-hooks/exhaustive-deps

  async function resync(reason: string) {
    try {
      const ongoing = await getOngoingMatch(matchId);
      const view = buildView(ongoing);
      if (!view) {
        setPhase({ kind: "error", message: "Server sent a board we can't parse." });
        return;
      }
      setPhase({ kind: "live", ongoing, view });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        try {
          const completed = await getCompletedMatch(matchId);
          setPhase((prev) => ({ kind: "over", completed, view: keptView(prev) }));
          return;
        } catch {
          // fall through
        }
      }
      setNotice(reason);
    }
  }

  function handleOutcome(o: MatchOutcome) {
    if (o.status === "ongoing" && o.ongoing) {
      const view = buildView(o.ongoing);
      if (!view) {
        setPhase({ kind: "error", message: "Server sent a board we can't parse." });
        return;
      }
      setPhase({ kind: "live", ongoing: o.ongoing, view });
    } else if (o.status === "completed" && o.completed) {
      setPhase((prev) => ({
        kind: "over",
        completed: o.completed!,
        view: keptView(prev),
      }));
    } else {
      setPhase({ kind: "aborted", matchId: o.match_id });
    }
  }

  async function onMove(m: Move) {
    if (!live || !session || sending) return;
    setSending(true);
    setNotice(null);
    try {
      const outcome = await playMove(
        identity,
        session.token,
        matchId,
        moveToUci(m),
        live.ongoing.ply,
      );
      handleOutcome(outcome);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 409 || e.status === 404)) {
        // Stale ply / race with the opponent or the match just ended —
        // resync to the authoritative position instead of showing a dead error.
        await resync(friendlyWriteError(e));
      } else {
        setNotice(friendlyWriteError(e));
      }
    } finally {
      setSending(false);
    }
  }

  const myColor = useMemo(() => {
    const side = session?.side.toLowerCase();
    if (side === "white") return "w" as const;
    if (side === "black") return "b" as const;
    if (!live) return null;
    // Fallback when the stored side is missing: infer from the identity.
    if (identity.studentId && identity.studentId === live.ongoing.white_id) return "w" as const;
    if (identity.studentId && identity.studentId === live.ongoing.black_id) return "b" as const;
    return null;
  }, [session?.side, live, identity.studentId]);

  const whiteStudent = useStudent(live?.ongoing.white_id ?? "…");
  const blackStudent = useStudent(live?.ongoing.black_id ?? "…");
  const turn = live?.view.game.turn ?? null;
  const view =
    phase.kind === "live" ? phase.view : phase.kind === "over" ? phase.view : null;

  // Your side sits at the bottom (board flipped for Black); the opponent on top.
  const profileFor = (color: "w" | "b", mine: boolean): SideProfile => {
    const student = color === "w" ? whiteStudent : blackStudent;
    const colorLabel = color === "w" ? "White" : "Black";
    const clock = clocks ? formatClock(color === "w" ? clocks.white : clocks.black) : null;
    return {
      key: color === "w" ? "white" : "black",
      tag: `${mine ? "You" : "Opponent"} · ${colorLabel}${clock ? ` · ${clock}` : ""}`,
      firstName: student.firstName,
      lastName: student.lastName,
      faculty: student.faculty,
      group: student.group,
      photo: student.photo ?? null,
      colorLabel,
      ready: undefined,
      isTurn: turn === color,
    };
  };
  const myProfile = profileFor(myColor ?? "w", true);
  const opponentProfile = profileFor(myColor === "b" ? "w" : "b", false);

  const identityPanel = (
    <>
      <IdentityFields value={identity} onChange={setIdentity} disabled={sending} />
      {!isValidIdentity(identity) && (
        <p className="hint">
          Enter your student ID + session token first — moves, resign and
          timeout claims all need player credentials plus your per-match game
          token.
        </p>
      )}
      {phase.kind === "need-token" && isValidIdentity(identity) && (
        <>
          <p className="muted">
            No game token for this match yet. The accepter got one in the
            invite response; the inviter issues theirs here (re-issuing
            replaces the old token immediately).
          </p>
          <button
            type="button"
            className="btn primary big"
            disabled={sending}
            onClick={onIssueToken}
          >
            {sending ? "Issuing…" : "Get my game token"}
          </button>
        </>
      )}
      {session && (
        <p className="hint">
          Game token held for {session.studentId || "this student"}
          {session.side ? ` · you play ${session.side}` : ""} ·{" "}
          <button
            type="button"
            className="link-btn"
            disabled={sending}
            onClick={onIssueToken}
          >
            Re-issue token
          </button>
        </p>
      )}
    </>
  );

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark">♞</span> ACT Chess · Match {matchId}
        </span>
      </header>
      <div className="room-body">
        <ProfileSidebar top={opponentProfile} bottom={myProfile} />
        <main className="room-main">
          {view ? (
            <ChessBoard
              game={view.game}
              history={view.history}
              lastMove={view.lastMove}
              locked={phase.kind !== "live"}
              lockLabel={
                phase.kind === "over"
                  ? resultLabel(phase.completed)
                  : sending
                    ? "Sending…"
                    : myColor === null
                      ? "Not your seat — check your identity"
                      : undefined
              }
              myColor={myColor}
              flipped={myColor === "b"}
              onMove={onMove}
            />
          ) : (
            <div className="room-stack">
              <div className="modal" style={{ maxWidth: 560 }}>
                <p className="eyebrow">Backend match · steps 3–4</p>
                {identityPanel}
                {notice && <p className="hint">{notice}</p>}
              </div>
              {phase.kind === "loading" && (
                <p className="muted">Loading match {matchId}…</p>
              )}
              {phase.kind === "error" && (
                <div className="modal">
                  <h3>Can't play this match</h3>
                  <p className="muted">{phase.message}</p>
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
              {phase.kind === "over" && (
                <div className="modal">
                  <h3>{resultLabel(phase.completed)}</h3>
                  {phase.completed.settlement_state && (
                    <p className="muted">
                      Points {phase.completed.settlement_state}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
