import { useEffect, useState } from "react";
import {
  ApiError,
  listCompletedMatches,
  listOngoingMatches,
  type CompletedMatch,
  type OngoingMatch,
  type PlayerIdentity,
} from "../net/api";
import {
  identityError,
  isValidStudentId,
  loadIdentity,
  saveIdentity,
} from "../net/identity";
import HealthDot from "./HealthDot";
import IdentityFields from "./IdentityFields";

function playUrl(matchId: string): string {
  return `${window.location.pathname}?play=${encodeURIComponent(matchId)}`;
}

function watchUrl(matchId: string): string {
  return `${window.location.pathname}?watch=${encodeURIComponent(matchId)}`;
}

function resultLabel(c: CompletedMatch): string {
  if (c.result === "draw") return `Draw · ${c.termination.replace(/_/g, " ")}`;
  const winner = c.result === "white" ? c.white_id : c.black_id;
  return `${winner} wins · ${c.termination.replace(/_/g, " ")}`;
}

function ongoingLabel(o: OngoingMatch): string {
  const turnId = o.turn === "white" ? o.white_id : o.black_id;
  return `${o.white_id} (White) vs ${o.black_id} (Black) · ${o.moves.length} moves · ${turnId} to move`;
}

const PAGE_SIZE = 20;

/**
 * Match history (optional step 5 slice): `?history[=<student_id>]`.
 * Public `GET ongoing/completed?student_id` lists, newest-first per the spec.
 * Aborted matches appear in neither list (deleted, not recorded).
 * Lists page (`limit` + `offset`) until a short page — "load more" appends.
 */
export default function HistoryRoom({ initialStudentId }: { initialStudentId: string }) {
  const [identity, setIdentity] = useState<PlayerIdentity>(() => {
    const saved = loadIdentity();
    if (initialStudentId && !saved.studentId) {
      return { ...saved, studentId: initialStudentId };
    }
    return initialStudentId && !isValidStudentId(saved.studentId)
      ? { ...saved, studentId: initialStudentId }
      : saved;
  });
  const [ongoing, setOngoing] = useState<OngoingMatch[] | null>(null);
  const [completed, setCompleted] = useState<CompletedMatch[] | null>(null);
  const [ongoingOffset, setOngoingOffset] = useState(0);
  const [completedOffset, setCompletedOffset] = useState(0);
  const [hasMoreOngoing, setHasMoreOngoing] = useState(false);
  const [hasMoreCompleted, setHasMoreCompleted] = useState(false);
  const [lookedUpId, setLookedUpId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreBusy, setMoreBusy] = useState<"ongoing" | "completed" | null>(null);

  useEffect(() => {
    saveIdentity(identity);
  }, [identity]);

  // Auto-load when opened with a valid ?history=<student_id>.
  useEffect(() => {
    if (initialStudentId && isValidStudentId(initialStudentId)) {
      void onLookup(initialStudentId);
    }
    // Once on mount — further lookups are manual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onLookup(override?: string) {
    const studentId = (override ?? identity.studentId).trim();
    if (!isValidStudentId(studentId)) {
      setMessage(identityError({ studentId, sessionToken: "x" }) ?? "Enter a valid student ID.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const [live, done] = await Promise.all([
        listOngoingMatches(studentId, { limit: PAGE_SIZE, offset: 0 }),
        listCompletedMatches(studentId, { limit: PAGE_SIZE, offset: 0 }),
      ]);
      setOngoing(live);
      setCompleted(done);
      setOngoingOffset(live.length);
      setCompletedOffset(done.length);
      // Bare arrays carry no total — a short page means the end.
      setHasMoreOngoing(live.length === PAGE_SIZE);
      setHasMoreCompleted(done.length === PAGE_SIZE);
      setLookedUpId(studentId);
      if (live.length === 0 && done.length === 0) {
        setMessage("No matches found for this student yet.");
      }
    } catch (e) {
      setOngoing(null);
      setCompleted(null);
      setLookedUpId(null);
      setMessage(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Can't reach the chess server.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onLoadMore(kind: "ongoing" | "completed") {
    if (!lookedUpId || moreBusy) return;
    setMoreBusy(kind);
    try {
      if (kind === "ongoing") {
        const page = await listOngoingMatches(lookedUpId, {
          limit: PAGE_SIZE,
          offset: ongoingOffset,
        });
        setOngoing((prev) => [...(prev ?? []), ...page]);
        setOngoingOffset((o) => o + page.length);
        if (page.length < PAGE_SIZE) setHasMoreOngoing(false);
      } else {
        const page = await listCompletedMatches(lookedUpId, {
          limit: PAGE_SIZE,
          offset: completedOffset,
        });
        setCompleted((prev) => [...(prev ?? []), ...page]);
        setCompletedOffset((o) => o + page.length);
        if (page.length < PAGE_SIZE) setHasMoreCompleted(false);
      }
    } catch (e) {
      setMessage(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Can't reach the chess server.",
      );
    } finally {
      setMoreBusy(null);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark">♞</span> ACT Chess · History
        </span>
        <HealthDot />
      </header>
      <div className="room-body" style={{ justifyContent: "center" }}>
        <div className="modal" style={{ maxWidth: 560 }}>
          <p className="eyebrow">Backend history · optional</p>
          <h3>Match history</h3>
          <IdentityFields value={identity} onChange={setIdentity} disabled={busy} />
          <button
            type="button"
            className="btn primary big"
            disabled={busy || !isValidStudentId(identity.studentId)}
            onClick={() => void onLookup()}
          >
            {busy ? "Loading…" : "Look up matches"}
          </button>

          {message && <p className="hint">{message}</p>}

          {ongoing !== null && (
            <>
              <p className="eyebrow">Ongoing · {ongoing.length}{hasMoreOngoing ? "+" : ""}</p>
              {ongoing.length === 0 ? (
                <p className="muted">No live matches.</p>
              ) : (
                <ul className="moves" style={{ maxHeight: 160 }}>
                  {ongoing.map((o) => (
                    <li key={o.match_id}>
                      <span className="move-no">●</span>
                      <span className="move-san" style={{ flex: 1 }}>
                        {ongoingLabel(o)}
                        <br />
                        <code style={{ overflowWrap: "anywhere" }}>{o.match_id}</code>
                      </span>
                      <span style={{ display: "flex", gap: 8 }}>
                        <a className="link-btn" href={playUrl(o.match_id)}>
                          Play
                        </a>
                        <a className="link-btn" href={watchUrl(o.match_id)}>
                          Watch
                        </a>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {hasMoreOngoing && ongoing.length > 0 && (
                <button
                  type="button"
                  className="link-btn"
                  disabled={moreBusy !== null}
                  onClick={() => void onLoadMore("ongoing")}
                >
                  {moreBusy === "ongoing" ? "Loading…" : `Load more (showing ${ongoing.length})`}
                </button>
              )}
            </>
          )}

          {completed !== null && (
            <>
              <p className="eyebrow">Completed · {completed.length}{hasMoreCompleted ? "+" : ""}</p>
              {completed.length === 0 ? (
                <p className="muted">No finished matches.</p>
              ) : (
                <ul className="moves" style={{ maxHeight: 220 }}>
                  {completed.map((c) => (
                    <li key={c.match_id}>
                      <span className="move-no">✓</span>
                      <span className="move-san" style={{ flex: 1 }}>
                        {resultLabel(c)}
                        {c.settlement_state ? ` · points ${c.settlement_state}` : ""}
                        <br />
                        <code style={{ overflowWrap: "anywhere" }}>{c.match_id}</code>
                      </span>
                      <a className="link-btn" href={watchUrl(c.match_id)}>
                        Replay
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {hasMoreCompleted && completed.length > 0 && (
                <button
                  type="button"
                  className="link-btn"
                  disabled={moreBusy !== null}
                  onClick={() => void onLoadMore("completed")}
                >
                  {moreBusy === "completed" ? "Loading…" : `Load more (showing ${completed.length})`}
                </button>
              )}
            </>
          )}

          <p className="hint">
            Lists are newest-first. Aborted matches (ended before both sides
            moved) are deleted — they appear in neither list. Tip:{" "}
            <code>?history=CS0103125</code> deep-links a student.
          </p>
        </div>
      </div>
    </div>
  );
}
