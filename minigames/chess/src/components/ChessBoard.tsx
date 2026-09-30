import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
	getGameResult,
	legalMovesForSquare,
	squareName,
	type GameState,
	type Move,
	type Piece,
	type PieceColor
} from '../chess/engine';
import type { HistoryEntry } from '../net/history';
import PieceIcon from './PieceIcon';
import { PIECE_NAME } from './pieceNames';

function MoveCell({ entry }: { entry: HistoryEntry | undefined }) {
	if (!entry) return <span className="move-san" />;
	const piece: Piece | undefined = entry.piece;
	return (
		<span className="move-san">
			{piece && <PieceIcon color={piece.color} type={piece.type} className="move-piece" titled />}
			{entry.san}
		</span>
	);
}

export type BoardControl = PieceColor | 'both' | null;

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
	/** Extra controls rendered above the move list (identity, resign, …). */
	sidePanel?: ReactNode;
	/** Draw the board from Black's side (a8 bottom-right). */
	flipped?: boolean;
}

export default function ChessBoard({
	game,
	history,
	lastMove,
	locked,
	lockLabel,
	myColor,
	onMove,
	sidePanel,
	flipped = false
}: Props) {
	const [selected, setSelected] = useState<{ r: number; c: number } | null>(null);
	const [targets, setTargets] = useState<Move[]>([]);
	const [pendingPromotion, setPendingPromotion] = useState<Move[] | null>(null);
	const movesRef = useRef<HTMLOListElement | null>(null);

	// Keep the latest move visible as the list grows from the top.
	useEffect(() => {
		const el = movesRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [history.length]);

	const result = useMemo(() => getGameResult(game), [game]);

	// --- Move / capture animation: fly the moved piece from -> to ---
	const lastEntry = history.length > 0 ? history[history.length - 1] : null;
	const [fly, setFly] = useState<{
		id: number;
		move: Move;
		piece: Piece;
		captured: boolean;
		arrived: boolean;
	} | null>(null);

	useEffect(() => {
		if (!lastMove || !lastEntry?.piece) return;
		try {
			if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
		} catch {
			// matchMedia unavailable — fall through to animated path
		}
		const id = history.length;
		const captured = lastEntry.captured !== null || lastMove.isEnPassant === true;
		setFly({
			id,
			move: { ...lastMove },
			piece: { ...lastEntry.piece },
			captured,
			arrived: false
		});
		const raf = requestAnimationFrame(() =>
			requestAnimationFrame(() => setFly((f) => (f && f.id === id ? { ...f, arrived: true } : f)))
		);
		const t = window.setTimeout(() => {
			setFly((f) => (f && f.id === id ? null : f));
		}, 340);
		return () => {
			cancelAnimationFrame(raf);
			window.clearTimeout(t);
		};
		// Animate once per new history entry.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [history.length]);

	const flyDestKey = fly ? `${fly.move.toR}-${fly.move.toC}` : null;
	// Castled rook also teleports — give it a landing pop too.
	const rookDestKey =
		fly?.move.isCastle != null
			? (() => {
					const homeRow = fly.piece.color === 'w' ? 7 : 0;
					return fly.move.isCastle === 'K' ? `${homeRow}-5` : `${homeRow}-3`;
				})()
			: null;

	const order = [0, 1, 2, 3, 4, 5, 6, 7];
	const rows = flipped ? [...order].reverse() : order;
	const cols = rows;
	// Board index → on-screen index (for the absolutely placed fly layer).
	const view = (i: number) => (flipped ? 7 - i : i);

	const kingInCheck: { r: number; c: number } | null = (() => {
		if (!result.inCheck) return null;
		for (let r = 0; r < 8; r++) {
			for (let c = 0; c < 8; c++) {
				const p = game.board[r][c];
				if (p && p.type === 'k' && p.color === game.turn) return { r, c };
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
		if (myColor === 'both') return true;
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
			if (myColor !== 'both' && piece.color !== myColor) {
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

	// Only the game-over result is announced above the board; whose turn it
	// is shows on the player cards.
	const overTitle =
		!locked && result.over
			? result.winner
				? `${result.reason} · ${result.winner === 'w' ? 'White' : 'Black'} wins`
				: `${result.reason} · Draw`
			: null;

	return (
		<div className="game-wrap">
			<div className="board-card">
				{overTitle && (
					<div className="turn-status over" role="status" aria-live="polite">
						<span className="turn-status-dot over" aria-hidden="true" />
						<strong>{overTitle}</strong>
						<span className="turn-status-detail">Game over</span>
					</div>
				)}
				<div className={`board-holder ${locked ? 'is-locked' : ''}`}>
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
								const sqKey = `${r}-${c}`;
								const isFlyDest = fly != null && sqKey === flyDestKey;
								const isRookDest = rookDestKey != null && sqKey === rookDestKey;
								const isLanding = isFlyDest || isRookDest;
								return (
									<button
										key={`${r}-${c}`}
										type="button"
										role="gridcell"
										aria-label={`${squareName(r, c)}${piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${piece.type}` : ''}`}
										className={[
											'sq',
											isLight ? 'light' : 'dark',
											isSel ? 'sel' : '',
											isLast ? 'last' : '',
											isCheck ? 'check' : '',
											isFlyDest && fly?.captured ? 'hit' : ''
										].join(' ')}
										onClick={() => onSquare(r, c)}
										disabled={locked}
									>
										{c === cols[0] && <span className="coord rank">{8 - r}</span>}
										{r === rows[7] && <span className="coord file">{'abcdefgh'[c]}</span>}
										{piece && !isFlyDest && (
											<PieceIcon
												key={isLanding ? `land-${history.length}` : undefined}
												color={piece.color}
												type={piece.type}
												className={`piece${isLanding ? 'anim-land' : ''}`}
											/>
										)}
										{isTarget && <span className={hasPiece ? 'capture-ring' : 'move-dot'} />}
									</button>
								);
							})
						)}
						{fly && (
							<div className="fly-layer" aria-hidden="true">
								{fly.captured && (
									<span
										key={`burst-${fly.id}`}
										className="capture-burst"
										style={{
											left: `${(view(fly.move.toC) * 100) / 8}%`,
											top: `${(view(fly.move.toR) * 100) / 8}%`
										}}
									/>
								)}
								<div
									className={`fly-piece ${fly.piece.color === 'w' ? 'pw' : 'pb'}${fly.arrived ? 'arrived' : ''}`}
									style={{
										left: `${(view(fly.arrived ? fly.move.toC : fly.move.fromC) * 100) / 8}%`,
										top: `${(view(fly.arrived ? fly.move.toR : fly.move.fromR) * 100) / 8}%`
									}}
								>
									<PieceIcon color={fly.piece.color} type={fly.piece.type} className="fly-glyph" />
								</div>
							</div>
						)}
					</div>
					{locked && (
						<div className="board-lock">
							<span>{lockLabel ?? 'Waiting for both players…'}</span>
						</div>
					)}
				</div>
			</div>

			<div className="right-col">
				{sidePanel && <div className="side-card">{sidePanel}</div>}
				<div className="empty-box">
					<div className="moves-head">Moves · {Math.ceil(history.length / 2)}</div>
					<ol className="moves" ref={movesRef}>
						{history.length === 0 && <li className="moves-empty">No moves yet</li>}
						{Array.from({ length: Math.ceil(history.length / 2) }).map((_, i) => (
							<li key={i}>
								<span className="move-no">{i + 1}.</span>
								<MoveCell entry={history[i * 2]} />
								<MoveCell entry={history[i * 2 + 1]} />
							</li>
						))}
					</ol>
				</div>
			</div>

			{pendingPromotion && (
				<div className="overlay" role="dialog" aria-modal="true" aria-label="Promote pawn">
					<div className="modal">
						<h3>Promote pawn</h3>
						<p>Choose a piece for {squareName(pendingPromotion[0].toR, pendingPromotion[0].toC)}</p>
						<div className="promo-row">
							{pendingPromotion.map((m) => (
								<button
									key={m.promotion}
									type="button"
									className="promo-btn"
									onClick={() => doMove(m)}
									aria-label={`Promote to ${PIECE_NAME[m.promotion ?? 'q']}`}
								>
									<PieceIcon color={game.turn} type={m.promotion ?? 'q'} className="promo-glyph" />
								</button>
							))}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
