import type { PieceType } from '../chess/engine';

/** Human-readable piece names, for labels and assistive tech. */
export const PIECE_NAME: Record<PieceType, string> = {
	k: 'King',
	q: 'Queen',
	r: 'Rook',
	b: 'Bishop',
	n: 'Knight',
	p: 'Pawn'
};
