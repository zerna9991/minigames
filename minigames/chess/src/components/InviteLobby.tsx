import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  cancelMyInvitation,
  getMyInvitation,
  issueGameSession,
  issueInvitation,
  listOngoingMatches,
  pollInvitationForMatch,
  watchInvitation,
  type IssuedInvitation,
  type PlayerIdentity,
} from "../net/api";
import {
  identityError,
  isValidIdentity,
  loadIdentity,
  saveIdentity,
} from "../net/identity";
import IdentityFields from "./IdentityFields";
import HealthDot from "./HealthDot";

type Status =
  | "idle"
  | "resuming"
  | "issuing"
  | "waiting"
  | "accepted"
  | "cancelled"
  | "replaced"
  | "expired"
  | "error";

function inviteLink(token: string): string {
  return `${window.location.origin}${window.location.pathname}?join=${encodeURIComponent(token)}`;
}

function playUrl(matchId: string): string {
  return `${window.location.pathname}?play=${encodeURIComponent(matchId)}`;
}

/**
 * Invitation lobby (step 2, inviter side): `POST /invitations` → share link +
 * `watch_key` stream. On `accepted`, issues the inviter's own game session
 * (step 3 token, stashed session-scoped for `?play=<match_id>`) and hands off
 * to the server-authoritative board (steps 3–4).
 */
export default function InviteLobby() {
  const [identity, setIdentity] = useState<PlayerIdentity>(() => loadIdentity());
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  // Resumed invitations have no token (GET /me omits it) — link can't be reshown.
  const [resumedNoToken, setResumedNoToken] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [matchId, setMatchId] = useState<string | null>(null);
  const [gameToken, setGameToken] = useState<string | null>(null);
  const [gameSide, setGameSide] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const streamDown = useRef(false);

  useEffect(() => {
    saveIdentity(identity);
  }, [identity]);

  // Resume a waiting screen after reload: GET /invitations/me.
  useEffect(() => {
    if (!isValidIdentity(identity)) {
      setStatus((s) => (s === "idle" ? s : s));
      return;
    }
    let cancelled = false;
    setStatus("resuming");
    getMyInvitation(identity)
      .then((me) => {
        if (cancelled) return;
        setIssued({
          token: "",
          watch_key: me.watch_key,
          inviter_id: me.inviter_id,
          created_at: me.created_at,
          expires_at: me.expires_at,
        });
        setResumedNoToken(true);
        setStatus("waiting");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setStatus("idle"); // no open invitation — normal case
        } else {
          setStatus("error");
          setMessage(
            err instanceof ApiError
              ? `${err.code}: ${err.message}`
              : "Can't reach the chess server.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
    // Resume once per identity change (session token / student ID edit).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.studentId, identity.sessionToken]);

  // Invitation SSE while waiting.
  const watchKey = status === "waiting" ? (issued?.watch_key ?? null) : null;
  useEffect(() => {
    if (!watchKey) return;
    streamDown.current = false;
    let unpoll: (() => void) | null = null;
    // `EventSource` never surfaces the HTTP status, so a refused stream
    // (spec's `503` over 200 watchers) degrades to polling the match list.
    const startPolling = () => {
      if (unpoll) return;
      setPolling(true);
      unpoll = pollInvitationForMatch(identity, (id) => {
        setMatchId(id);
        setStatus("accepted");
      });
    };
    const unwatch = watchInvitation(watchKey, {
      onWaiting: () => setStatus("waiting"),
      onAccepted: (id) => {
        setMatchId(id || null);
        setStatus("accepted");
      },
      onCancelled: () => setStatus("cancelled"),
      onReplaced: () => setStatus("replaced"),
      onExpired: () => setStatus("expired"),
      onError: () => {
        setMessage("Invitation stream busy — polling for the match every few seconds…");
        startPolling();
      },
    });
    return () => {
      unwatch();
      unpoll?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey]);

  // After accept: fetch the inviter's own game token (step 3) in the background.
  useEffect(() => {
    if (status !== "accepted" || !matchId || gameToken) return;
    let cancelled = false;
    issueGameSession(identity, matchId)
      .then((s) => {
        if (cancelled) return;
        setGameToken(s.token);
        setGameSide(s.side);
        try {
          sessionStorage.setItem(
            `act-chess-game-${matchId}`,
            JSON.stringify({
              token: s.token,
              side: s.side,
              studentId: identity.studentId,
            }),
          );
        } catch {
          // storage unavailable — the play view can re-issue
        }
      })
      .catch(() => {
        // Non-fatal: the match exists; the token can be re-issued in step 3 UI.
        if (!cancelled)
          setMessage("Match started, but fetching your game token failed — retry from the match view.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, matchId]);

  async function onIssue() {
    const err = identityError(identity);
    if (err) {
      setMessage(err);
      return;
    }
    setBusy(true);
    setMessage(null);
    setCopied(false);
    setMatchId(null);
    setGameToken(null);
    setGameSide(null);
    setResumedNoToken(false);
    setPolling(false);
    try {
      const inv = await issueInvitation(identity);
      setIssued(inv);
      setStatus("waiting");
    } catch (e) {
      setStatus("error");
      setMessage(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Can't reach the chess server.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    setBusy(true);
    try {
      await cancelMyInvitation(identity);
      setStatus("cancelled");
    } catch (e) {
      setMessage(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Can't reach the chess server.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    if (!issued?.token) return;
    try {
      await navigator.clipboard.writeText(inviteLink(issued.token));
      setCopied(true);
    } catch {
      setMessage("Copy failed — select the link manually.");
    }
  }

  async function onCheckMatchList() {
    // Recovery path from the spec: a 404 on the stream may mean the match
    // already exists — look it up under ongoing.
    try {
      const list = await listOngoingMatches(identity.studentId.trim());
      const mine = list[0];
      if (mine) {
        setMatchId(mine.match_id);
        setStatus("accepted");
      } else {
        setMessage("No ongoing match found for this student yet.");
      }
    } catch (e) {
      setMessage(
        e instanceof ApiError ? `${e.code}: ${e.message}` : "Can't reach the chess server.",
      );
    }
  }

  const waiting = status === "waiting" || status === "resuming";
  const link = issued?.token ? inviteLink(issued.token) : null;

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark">♞</span> ACT Chess · Invite
        </span>
        <HealthDot />
      </header>
      <div className="room-body" style={{ justifyContent: "center" }}>
        <div className="modal" style={{ maxWidth: 520 }}>
          <p className="eyebrow">Backend lobby · step 2</p>
          <h3>Invite a friend</h3>
          <IdentityFields
            value={identity}
            onChange={setIdentity}
            disabled={waiting || status === "issuing"}
          />

          {status === "idle" || status === "error" || status === "issuing" ? (
            <>
              <button
                type="button"
                className="btn primary big"
                disabled={busy || !isValidIdentity(identity)}
                onClick={onIssue}
              >
                {busy ? "Creating link…" : "Create invitation link"}
              </button>
              <p className="hint">
                One open invitation per student — creating a new one replaces the
                old link. Links expire after 24 h and are single-use.
              </p>
            </>
          ) : null}

          {status === "resuming" && <p className="muted">Checking for an open invitation…</p>}

          {status === "waiting" && issued && (
            <>
              <p className="muted">
                Waiting for your friend… keep this page open. Expires{" "}
                {new Date(issued.expires_at).toLocaleString()}.
              </p>
              {polling && (
                <p className="hint">
                  Invitation stream busy — polling for the match every few seconds…
                </p>
              )}
              {link ? (
                <>
                  <p className="muted" style={{ overflowWrap: "anywhere" }}>
                    Share link: <code>{link}</code>
                  </p>
                  <div className="btn-row">
                    <button type="button" className="btn primary" onClick={onCopy}>
                      {copied ? "Copied ✓" : "Copy link"}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy}
                      onClick={onCancel}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {resumedNoToken && (
                    <p className="hint">
                      Resumed after reload — the token is shown only at issue
                      time, so re-issue to get a fresh share link, or cancel
                      below.
                    </p>
                  )}
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busy || !isValidIdentity(identity)}
                      onClick={onIssue}
                    >
                      Re-issue link
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy}
                      onClick={onCancel}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
              <button type="button" className="link-btn" onClick={onCheckMatchList}>
                Already accepted? Look up my match
              </button>
            </>
          )}

          {status === "accepted" && matchId && (
            <>
              <p className="muted">
                Accepted! Match <code>{matchId}</code>
                {gameSide ? ` · you play ${gameSide}` : ""}.
              </p>
              {gameToken ? (
                <p className="hint">
                  Your game token arrived (shown once, step 3 will use it):{" "}
                  <code style={{ overflowWrap: "anywhere" }}>{gameToken}</code>
                </p>
              ) : (
                <p className="hint">Fetching your game token…</p>
              )}
              <a className="btn primary big" href={playUrl(matchId)}>
                Play the match
              </a>
              <p className="hint">
                Your game token is saved for this browser tab — the play view
                picks it up automatically. Spectating also works via{" "}
                <code>?watch={matchId}</code>.
              </p>
            </>
          )}

          {(status === "cancelled" || status === "replaced" || status === "expired") && (
            <>
              <p className="muted">
                {status === "cancelled" && "Invitation cancelled."}
                {status === "replaced" && "Invitation replaced — you issued a newer link."}
                {status === "expired" && "Invitation expired (24 h). Issue a fresh one."}
              </p>
              <button
                type="button"
                className="btn primary big"
                disabled={busy || !isValidIdentity(identity)}
                onClick={onIssue}
              >
                Issue a new link
              </button>
            </>
          )}

          {message && <p className="hint">{message}</p>}
          <p className="hint">
            Tip: open <code>?invite</code> to host, <code>?join=&lt;token&gt;</code>{" "}
            to accept, <code>?play=&lt;match_id&gt;</code> to play,{" "}
            <code>?watch=&lt;match_id&gt;</code> to spectate,{" "}
            <code>?history=&lt;student_id&gt;</code> for past games.
          </p>
        </div>
      </div>
    </div>
  );
}
