import type { Move, Piece } from '../chess/engine';

/** A single applied move for display (board + move list + animation). */
export interface HistoryEntry {
	san: string;
	move: Move;
	captured: Piece | null;
	piece: Piece;
}
