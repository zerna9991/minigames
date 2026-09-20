import { useEffect, useState } from "react";
import {
  ApiError,
  acceptInvitation,
  type PlayerIdentity,
  type StartedMatch,
} from "../net/api";
import {
  generateSessionToken,
  identityError,
  isValidIdentity,
  loadIdentity,
  saveIdentity,
} from "../net/identity";
import IdentityFields from "./IdentityFields";

function playUrl(matchId: string): string {
  return `${window.location.pathname}?play=${encodeURIComponent(matchId)}`;
}

function friendlyAcceptError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404)
      return "not_found: this link is unknown, already used, cancelled, replaced, or expired — ask the host for a fresh one.";
    if (e.status === 409)
      return "conflict: you can't accept your own invitation — open this link as a different student.";
    return `${e.code}: ${e.message}`;
  }
  return "Can't reach the chess server.";
}

/**
 * Invitation accept (step 2, friend side): `POST /invitations/accept {token}`
 * → `{ongoing, session}`. The accepter's game token is stashed session-scoped
 * (keyed by match) so `?play=<match_id>` can pick it up; board play itself
 * lives in PlayRoom (steps 3–4). The token is shown once — never logged.
 */
export default function JoinRoom({ token }: { token: string }) {
  // The session token is generated for the player — no field, no typing.
  const [identity, setIdentity] = useState<PlayerIdentity>(() => {
    const saved = loadIdentity();
    return {
      ...saved,
      sessionToken: saved.sessionToken.trim() || generateSessionToken(),
    };
  });
  const [started, setStarted] = useState<StartedMatch | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    saveIdentity(identity);
  }, [identity]);

  async function onAccept() {
    const err = identityError(identity);
    if (err) {
      setMessage(err);
      return;
    }
    if (!token) {
      setMessage("No invitation token in the URL (?join=<token>).");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await acceptInvitation(identity, token);
      // Hand the game token to the play view (session-scoped, per match).
      try {
        sessionStorage.setItem(
          `act-chess-game-${res.ongoing.match_id}`,
          JSON.stringify({
            token: res.session.token,
            side: res.session.side,
            studentId: identity.studentId,
          }),
        );
      } catch {
        // storage unavailable — the reveal-once token below still works
      }
      setStarted(res);
    } catch (e) {
      setMessage(friendlyAcceptError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark">♞</span> ACT Chess · Join
        </span>
      </header>
      <div className="room-body" style={{ justifyContent: "center" }}>
        <div className="modal" style={{ maxWidth: 520 }}>
          <p className="eyebrow">Backend lobby · step 2</p>
          <h3>Join the match</h3>
          {!token && (
            <p className="muted">
              No token in the URL. Ask the host for a fresh invite link
              (<code>?join=&lt;token&gt;</code>).
            </p>
          )}
          {!started ? (
            <>
              <IdentityFields
                value={identity}
                onChange={setIdentity}
                disabled={busy}
                hideToken
              />
              <p className="hint">
                Accepting consumes the link exactly once and assigns colours at
                random. Each side gets 10 min + 5 s/move.
              </p>
              <button
                type="button"
                className="btn primary big"
                disabled={busy || !isValidIdentity(identity) || !token}
                onClick={onAccept}
              >
                {busy ? "Joining…" : "Accept & start match"}
              </button>
            </>
          ) : (
            <>
              <p className="muted">
                Match <code style={{ overflowWrap: "anywhere" }}>{started.ongoing.match_id}</code>{" "}
                started — {started.ongoing.white_id} (White) vs{" "}
                {started.ongoing.black_id} (Black). You play{" "}
                <strong>{started.session.side}</strong>.
              </p>
              <p className="hint">
                Your game token (shown once — copy it now, it dies with the
                match):
              </p>
              <p className="muted" style={{ overflowWrap: "anywhere" }}>
                <code>{revealed ? started.session.token : "•••••••• (click reveal)"}</code>{" "}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setRevealed((r) => !r)}
                >
                  {revealed ? "Hide" : "Reveal"}
                </button>
              </p>
              <a className="btn primary big" href={playUrl(started.ongoing.match_id)}>
                Play the match
              </a>
              <p className="hint">
                Your game token is already saved for this browser tab — the
                play view picks it up automatically. Spectating also works via{" "}
                <code>?watch={started.ongoing.match_id}</code>.
              </p>
            </>
          )}
          {message && <p className="hint">{message}</p>}
        </div>
      </div>
    </div>
  );
}
