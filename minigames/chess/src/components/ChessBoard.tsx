import { useMemo, useState } from "react";
import {
  getGameResult,
  legalMovesForSquare,
  squareName,
  type GameState,
  type Move,
  type PieceColor,
  type PieceType,
} from "../chess/engine";
import type { HistoryEntry } from "../net/useSyncedGame";

const GLYPH: Record<PieceColor, Record<PieceType, string>> = {
  w: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

export type BoardControl = PieceColor | "both" | null;

interface Props {
  game: GameState;
  history: HistoryEntry[];
  lastMove: Move | null;
  /** When true the board is visible but not interactable (lobby / waiting). */
  locked: boolean;
  lockLabel?: string;
  /** Which color this screen may move. 'both' = same-screen play, null = spectator. */
  myColor: BoardControl;
  onMove: (m: Move) => void;
}

export default function ChessBoard({
  game,
  history,
  lastMove,
  locked,
  lockLabel,
  myColor,
  onMove,
}: Props) {
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(
    null,
  );
  const [targets, setTargets] = useState<Move[]>([]);
  const [pendingPromotion, setPendingPromotion] = useState<Move[] | null>(null);

  const result = useMemo(() => getGameResult(game), [game]);

  const rows = [0, 1, 2, 3, 4, 5, 6, 7];
  const cols = [0, 1, 2, 3, 4, 5, 6, 7];

  const kingInCheck: { r: number; c: number } | null = (() => {
    if (!result.inCheck) return null;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = game.board[r][c];
        if (p && p.type === "k" && p.color === game.turn) return { r, c };
      }
    }
    return null;
  })();

  function clearSelection() {
    setSelected(null);
    setTargets([]);
  }

  function canMoveNow(): boolean {
    if (locked || result.over || pendingPromotion) return false;
    if (myColor === "both") return true;
    if (myColor === null) return false;
    return game.turn === myColor;
  }

  function doMove(m: Move) {
    onMove(m);
    clearSelection();
    setPendingPromotion(null);
  }

  function onSquare(r: number, c: number) {
    if (!canMoveNow()) return;
    const piece = game.board[r][c];

    if (selected) {
      const options = targets.filter((t) => t.toR === r && t.toC === c);
      if (options.length > 0) {
        if (options.length > 1 && options[0].promotion) {
          setPendingPromotion(options);
          return;
        }
        doMove(options[0]);
        return;
      }
    }

    if (piece && piece.color === game.turn) {
      // In online play you may only touch your own color.
      if (myColor !== "both" && piece.color !== myColor) {
        clearSelection();
        return;
      }
      if (selected && selected.r === r && selected.c === c) {
        clearSelection();
        return;
      }
      setSelected({ r, c });
      setTargets(legalMovesForSquare(game, r, c));
      return;
    }

    clearSelection();
  }

  const targetKeys = new Set(targets.map((t) => `${t.toR}-${t.toC}`));

  return (
    <div className="game-wrap">
      <div className="board-card">
        <div className={`board-holder ${locked ? "is-locked" : ""}`}>
          <div className="board" role="grid" aria-label="Chess board">
            {rows.map((r) =>
              cols.map((c) => {
                const piece = game.board[r][c];
                const isLight = (r + c) % 2 === 1;
                const isSel = selected?.r === r && selected?.c === c;
                const isTarget = targetKeys.has(`${r}-${c}`);
                const isLast =
                  lastMove &&
                  ((lastMove.fromR === r && lastMove.fromC === c) ||
                    (lastMove.toR === r && lastMove.toC === c));
                const isCheck = kingInCheck?.r === r && kingInCheck?.c === c;
                const hasPiece = piece !== null;
                return (
                  <button
                    key={`${r}-${c}`}
                    type="button"
                    role="gridcell"
                    aria-label={`${squareName(r, c)}${piece ? ` ${piece.color === "w" ? "white" : "black"} ${piece.type}` : ""}`}
                    className={[
                      "sq",
                      isLight ? "light" : "dark",
                      isSel ? "sel" : "",
                      isLast ? "last" : "",
                      isCheck ? "check" : "",
                    ].join(" ")}
                    onClick={() => onSquare(r, c)}
                    disabled={locked}
                  >
                    {c === 0 && (
                      <span className="coord rank">{8 - r}</span>
                    )}
                    {r === 7 && (
                      <span className="coord file">{"abcdefgh"[c]}</span>
                    )}
                    {piece && (
                      <span
                        className={`piece ${piece.color === "w" ? "pw" : "pb"}`}
                      >
                        {GLYPH[piece.color][piece.type]}
                      </span>
                    )}
                    {isTarget && (
                      <span
                        className={hasPiece ? "capture-ring" : "move-dot"}
                      />
                    )}
                  </button>
                );
              }),
            )}
          </div>
          {locked && (
            <div className="board-lock">
              <span>{lockLabel ?? "Waiting for both players…"}</span>
            </div>
          )}
        </div>
      </div>

      <div className="right-col">
        <div className="empty-box">
          <div className="moves-head">
            Moves · {Math.ceil(history.length / 2)}
          </div>
          <ol className="moves">
            {history.length === 0 && (
              <li className="moves-empty">No moves yet</li>
            )}
            {Array.from({ length: Math.ceil(history.length / 2) }).map(
              (_, i) => (
                <li key={i}>
                  <span className="move-no">{i + 1}.</span>
                  <span className="move-san">{history[i * 2]?.san}</span>
                  <span className="move-san">
                    {history[i * 2 + 1]?.san ?? ""}
                  </span>
                </li>
              ),
            )}
          </ol>
        </div>
      </div>

      {pendingPromotion && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Promote pawn"
        >
          <div className="modal">
            <h3>Promote pawn</h3>
            <p>
              Choose a piece for{" "}
              {squareName(pendingPromotion[0].toR, pendingPromotion[0].toC)}
            </p>
            <div className="promo-row">
              {pendingPromotion.map((m) => (
                <button
                  key={m.promotion}
                  type="button"
                  className="promo-btn"
                  onClick={() => doMove(m)}
                  aria-label={`Promote to ${m.promotion}`}
                >
                  {GLYPH[game.turn][m.promotion ?? "q"]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
