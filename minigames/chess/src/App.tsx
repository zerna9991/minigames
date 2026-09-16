import { useEffect, useState, type ReactNode } from "react";
import ChessBoard from "./components/ChessBoard";
import ProfileSidebar from "./components/ProfileSidebar";
import { resolveStudent } from "./data/students";
import { useSyncedGame, type HistoryEntry } from "./net/useSyncedGame";
import {
  applyMove,
  createInitialState,
  moveToSan,
  type GameState,
  type Move,
  type Piece,
} from "./chess/engine";
import "./App.css";

function getParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function makeGameId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** Shareable room link — carries the room only, never a per-tab player name. */
function inviteUrl(gameId: string): string {
  return `${window.location.origin}${window.location.pathname}?game=${gameId}`;
}

/** Stable per-tab identity so two tabs never share a display name. */
function tabName(fallback: string): string {
  if (fallback) return fallback;
  try {
    const existing = sessionStorage.getItem("act-chess-you");
    if (existing) return existing;
    const fresh = `Player-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    sessionStorage.setItem("act-chess-you", fresh);
    return fresh;
  } catch {
    return "Player";
  }
}

/* ---------------- Shared room chrome ---------------- */

function RoomShell(props: {
  lobbyLine: ReactNode;
  sidebar: ReactNode;
  board: ReactNode;
  modal: ReactNode;
}) {
  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark">♞</span> ACT Chess
        </span>
      </header>
      <div className="lobby-strip">{props.lobbyLine}</div>
      <div className="room-body">
        {props.sidebar}
        <main className="room-main">{props.board}</main>
      </div>
      {props.modal}
    </div>
  );
}

/* ---------------- Online room: 2 players, handshake ---------------- */

function OnlineRoom({ gameId, you }: { gameId: string; you: string }) {
  const room = useSyncedGame(gameId, you);
  const { opponent, bothJoined, bothReady, myReady, opponentReady } = room;

  const myColorLabel =
    room.myColor === "w"
      ? "White"
      : room.myColor === "b"
        ? "Black"
        : "Spectating";
  const resolvedWhite =
    room.myColor === "w"
      ? you
      : opponent?.color === "w"
        ? opponent.name
        : "White";
  const resolvedBlack =
    room.myColor === "b"
      ? you
      : opponent?.color === "b"
        ? opponent.name
        : "Black";
  const oppColor = opponent?.color ?? (room.myColor === "w" ? "b" : "w");
  const myStudent = resolveStudent(you);
  const oppStudent = opponent ? resolveStudent(opponent.name) : null;

  function copyInvite() {
    void navigator.clipboard
      ?.writeText(inviteUrl(gameId))
      .catch(() => undefined);
  }

  const lobbyLine = !bothJoined ? (
    <span>
      <strong>{you}</strong> is in the lobby · waiting for opponent… share the
      room code <strong>{gameId}</strong> or{" "}
      <button type="button" className="link-btn" onClick={copyInvite}>
        copy the invite link
      </button>
      .
    </span>
  ) : bothReady ? (
    <span>
      <strong>{you}</strong> vs <strong>{opponent?.name}</strong> · game
      started.
    </span>
  ) : (
    <span>
      Both players are in the lobby · waiting for OK ({myReady ? 1 : 0} +{" "}
      {opponentReady ? 1 : 0} / 2).
    </span>
  );

  return (
    <RoomShell
      lobbyLine={lobbyLine}
      sidebar={
        <ProfileSidebar
          top={{
            key: "opponent",
            tag: "Opponent",
            firstName: oppStudent?.firstName ?? "Waiting",
            lastName: oppStudent?.lastName ?? "for opponent…",
            faculty: oppStudent?.faculty ?? "—",
            group: oppStudent?.group ?? "—",
            photo: oppStudent?.photo ?? null,
            colorLabel: oppColor === "w" ? "White" : "Black",
            ready: bothJoined ? opponentReady : undefined,
            isTurn: bothReady && room.game.turn === oppColor,
          }}
          bottom={{
            key: "you",
            tag: "You",
            firstName: myStudent.firstName,
            lastName: myStudent.lastName,
            faculty: myStudent.faculty,
            group: myStudent.group,
            photo: myStudent.photo ?? null,
            colorLabel: myColorLabel,
            ready: bothJoined ? myReady : undefined,
            isTurn:
              bothReady &&
              room.myColor !== null &&
              room.game.turn === room.myColor,
          }}
        />
      }
      board={
        <ChessBoard
          whiteName={resolvedWhite}
          blackName={resolvedBlack}
          game={room.game}
          history={room.history}
          lastMove={room.lastMove}
          locked={!bothReady}
          lockLabel={
            !bothJoined ? "Waiting for opponent…" : "Press OK to start"
          }
          myColor={room.myColor === null ? null : room.myColor}
          onMove={room.doMove}
        />
      }
      modal={
        bothJoined && !bothReady && opponent ? (
          <div
            className="overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Welcome"
          >
            <div className="modal">
              <p className="eyebrow">ACT Chess · Room {gameId}</p>
              <h3>
                Welcome to ACT Chess, you are now playing with {opponent.name}
              </h3>
              {!myReady ? (
                <>
                  <p className="muted">
                    Press OK when you are ready. The board unlocks once both
                    players press OK.
                  </p>
                  <button
                    type="button"
                    className="btn primary big"
                    onClick={room.pressReady}
                    autoFocus
                  >
                    OK
                  </button>
                </>
              ) : (
                <>
                  <p className="muted">
                    You pressed OK. Waiting for {opponent.name} to press OK…
                  </p>
                  <button type="button" className="btn primary big" disabled>
                    Waiting for {opponent.name}…
                  </button>
                </>
              )}
              <p className="hint">
                {opponentReady
                  ? `${opponent.name} is ready.`
                  : `${opponent.name} has not pressed OK yet.`}{" "}
                You play {myColorLabel}.
              </p>
            </div>
          </div>
        ) : undefined
      }
    />
  );
}

/* ---------------- Local room: same screen, dual OK ---------------- */

function LocalRoom({
  gameId,
  whiteName,
  blackName,
}: {
  gameId: string;
  whiteName: string;
  blackName: string;
}) {
  const [game, setGame] = useState<GameState>(() => createInitialState());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [whiteOk, setWhiteOk] = useState(false);
  const [blackOk, setBlackOk] = useState(false);
  const bothReady = whiteOk && blackOk;
  const whiteStudent = resolveStudent(whiteName);
  const blackStudent = resolveStudent(blackName);

  function doMove(m: Move) {
    const san = moveToSan(game, m);
    const captured: Piece | null = m.isEnPassant
      ? { type: "p", color: game.turn === "w" ? "b" : "w" }
      : (game.board[m.toR][m.toC] ?? null);
    setGame(applyMove(game, m));
    setHistory((h) => [...h, { san, move: m, captured }]);
    setLastMove(m);
  }

  return (
    <RoomShell
      lobbyLine={
        bothReady ? (
          <span>
            <strong>{whiteName}</strong> vs <strong>{blackName}</strong> · game
            started.
          </span>
        ) : (
          <span>
            Both players are in the lobby · waiting for OK (
            {(whiteOk ? 1 : 0) + (blackOk ? 1 : 0)} / 2).
          </span>
        )
      }
      sidebar={
        <ProfileSidebar
          top={{
            key: "black",
            tag: "Opponent · Black",
            firstName: blackStudent.firstName,
            lastName: blackStudent.lastName,
            faculty: blackStudent.faculty,
            group: blackStudent.group,
            photo: blackStudent.photo ?? null,
            colorLabel: "Black",
            ready: blackOk,
            isTurn: bothReady && game.turn === "b",
          }}
          bottom={{
            key: "white",
            tag: "You · White",
            firstName: whiteStudent.firstName,
            lastName: whiteStudent.lastName,
            faculty: whiteStudent.faculty,
            group: whiteStudent.group,
            photo: whiteStudent.photo ?? null,
            colorLabel: "White",
            ready: whiteOk,
            isTurn: bothReady && game.turn === "w",
          }}
        />
      }
      board={
        <ChessBoard
          whiteName={whiteName}
          blackName={blackName}
          game={game}
          history={history}
          lastMove={lastMove}
          locked={!bothReady}
          lockLabel="Press OK to start"
          myColor="both"
          onMove={doMove}
        />
      }
      modal={
        !bothReady ? (
          <div
            className="overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Welcome"
          >
            <div className="modal">
              <p className="eyebrow">ACT Chess · Room {gameId}</p>
              <h3>
                Welcome to ACT Chess, {whiteName} you are now playing with{" "}
                {blackName}
              </h3>
              <p className="muted">
                Each player presses their own OK. The board unlocks after both
                press OK.
              </p>
              <div className="btn-row">
                <button
                  type="button"
                  className={`btn ${whiteOk ? "secondary" : "primary"}`}
                  onClick={() => setWhiteOk(true)}
                  disabled={whiteOk}
                >
                  {whiteOk ? `${whiteName} ✓` : `${whiteName} · OK`}
                </button>
                <button
                  type="button"
                  className={`btn ${blackOk ? "secondary" : "primary"}`}
                  onClick={() => setBlackOk(true)}
                  disabled={blackOk}
                >
                  {blackOk ? `${blackName} ✓` : `${blackName} · OK`}
                </button>
              </div>
            </div>
          </div>
        ) : undefined
      }
    />
  );
}

/* ---------------- App: straight into the room, no entry page ---------------- */

type Route =
  | { mode: "online"; gameId: string; you: string }
  | { mode: "local"; gameId: string; whiteName: string; blackName: string };

function initialRoute(): Route {
  const q = getParams();
  const game = (q.get("game") ?? "").trim().toUpperCase() || makeGameId();
  if (q.get("local") === "1") {
    return {
      mode: "local",
      gameId: game,
      whiteName: (q.get("white") ?? "").trim() || "White",
      blackName: (q.get("black") ?? "").trim() || "Black",
    };
  }
  return {
    mode: "online",
    gameId: game,
    you: tabName((q.get("you") ?? "").trim()),
  };
}

export default function App() {
  const [route] = useState<Route>(initialRoute);

  // Keep the room shareable: ensure the URL carries ?game=… (no page change).
  useEffect(() => {
    if (!getParams().get("game")) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?game=${route.gameId}`,
      );
    }
  }, [route.gameId]);

  if (route.mode === "local") {
    return (
      <LocalRoom
        gameId={route.gameId}
        whiteName={route.whiteName}
        blackName={route.blackName}
      />
    );
  }
  return <OnlineRoom gameId={route.gameId} you={route.you} />;
}
