export type PieceColor = 'w' | 'b';
export type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p';

export interface Piece {
	type: PieceType;
	color: PieceColor;
}

export type Board = (Piece | null)[][];

export interface CastlingRights {
	wK: boolean;
	wQ: boolean;
	bK: boolean;
	bQ: boolean;
}

export interface EnPassantTarget {
	r: number;
	c: number;
}

export interface GameState {
	board: Board;
	turn: PieceColor;
	castling: CastlingRights;
	enPassant: EnPassantTarget | null;
	halfmove: number;
	fullmove: number;
}

export interface Move {
	fromR: number;
	fromC: number;
	toR: number;
	toC: number;
	promotion?: PieceType;
	isCastle?: 'K' | 'Q';
	isEnPassant?: boolean;
}

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export function squareName(r: number, c: number): string {
	return `${FILES[c]}${8 - r}`;
}

export function opposite(color: PieceColor): PieceColor {
	return color === 'w' ? 'b' : 'w';
}

function inBounds(r: number, c: number): boolean {
	return r >= 0 && r < 8 && c >= 0 && c < 8;
}

export function createInitialState(): GameState {
	const back: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
	const board: Board = Array.from({ length: 8 }, () => Array<Piece | null>(8).fill(null));
	for (let c = 0; c < 8; c++) {
		board[0][c] = { type: back[c], color: 'b' };
		board[1][c] = { type: 'p', color: 'b' };
		board[6][c] = { type: 'p', color: 'w' };
		board[7][c] = { type: back[c], color: 'w' };
	}
	return {
		board,
		turn: 'w',
		castling: { wK: true, wQ: true, bK: true, bQ: true },
		enPassant: null,
		halfmove: 0,
		fullmove: 1
	};
}

export function cloneState(s: GameState): GameState {
	return {
		board: s.board.map((row) => row.map((p) => (p ? { ...p } : null))),
		turn: s.turn,
		castling: { ...s.castling },
		enPassant: s.enPassant ? { ...s.enPassant } : null,
		halfmove: s.halfmove,
		fullmove: s.fullmove
	};
}

function findKing(board: Board, color: PieceColor): { r: number; c: number } | null {
	for (let r = 0; r < 8; r++) {
		for (let c = 0; c < 8; c++) {
			const p = board[r][c];
			if (p && p.type === 'k' && p.color === color) return { r, c };
		}
	}
	return null;
}

export function isSquareAttacked(board: Board, r: number, c: number, by: PieceColor): boolean {
	const pawnDir = by === 'w' ? 1 : -1;
	for (const dc of [-1, 1]) {
		const pr = r + pawnDir;
		const pc = c + dc;
		if (inBounds(pr, pc)) {
			const p = board[pr][pc];
			if (p && p.color === by && p.type === 'p') return true;
		}
	}

	const knightDeltas = [
		[-2, -1],
		[-2, 1],
		[-1, -2],
		[-1, 2],
		[1, -2],
		[1, 2],
		[2, -1],
		[2, 1]
	];
	for (const [dr, dc] of knightDeltas) {
		const nr = r + dr;
		const nc = c + dc;
		if (inBounds(nr, nc)) {
			const p = board[nr][nc];
			if (p && p.color === by && p.type === 'n') return true;
		}
	}

	for (let dr = -1; dr <= 1; dr++) {
		for (let dc = -1; dc <= 1; dc++) {
			if (dr === 0 && dc === 0) continue;
			const nr = r + dr;
			const nc = c + dc;
			if (inBounds(nr, nc)) {
				const p = board[nr][nc];
				if (p && p.color === by && p.type === 'k') return true;
			}
		}
	}

	const bishopDirs = [
		[-1, -1],
		[-1, 1],
		[1, -1],
		[1, 1]
	];
	const rookDirs = [
		[-1, 0],
		[1, 0],
		[0, -1],
		[0, 1]
	];
	for (const [dr, dc] of bishopDirs) {
		let nr = r + dr;
		let nc = c + dc;
		while (inBounds(nr, nc)) {
			const p = board[nr][nc];
			if (p) {
				if (p.color === by && (p.type === 'b' || p.type === 'q')) return true;
				break;
			}
			nr += dr;
			nc += dc;
		}
	}
	for (const [dr, dc] of rookDirs) {
		let nr = r + dr;
		let nc = c + dc;
		while (inBounds(nr, nc)) {
			const p = board[nr][nc];
			if (p) {
				if (p.color === by && (p.type === 'r' || p.type === 'q')) return true;
				break;
			}
			nr += dr;
			nc += dc;
		}
	}
	return false;
}

export function isInCheck(state: GameState, color: PieceColor): boolean {
	const k = findKing(state.board, color);
	if (!k) return false;
	return isSquareAttacked(state.board, k.r, k.c, opposite(color));
}

function pseudoMovesForSquare(state: GameState, r: number, c: number): Move[] {
	const { board, castling, enPassant } = state;
	const piece = board[r][c];
	if (!piece) return [];
	const moves: Move[] = [];
	const color = piece.color;
	const push = (toR: number, toC: number, extra?: Partial<Move>) => {
		if (!inBounds(toR, toC)) return;
		moves.push({ fromR: r, fromC: c, toR, toC, ...extra });
	};

	if (piece.type === 'p') {
		const dir = color === 'w' ? -1 : 1;
		const startRow = color === 'w' ? 6 : 1;
		const promoRow = color === 'w' ? 0 : 7;
		// Forward
		if (inBounds(r + dir, c) && !board[r + dir][c]) {
			if (r + dir === promoRow) {
				for (const promo of ['q', 'r', 'b', 'n'] as PieceType[]) {
					push(r + dir, c, { promotion: promo });
				}
			} else {
				push(r + dir, c);
				if (r === startRow && !board[r + 2 * dir][c]) {
					push(r + 2 * dir, c);
				}
			}
		}

		for (const dc of [-1, 1]) {
			const nr = r + dir;
			const nc = c + dc;
			if (!inBounds(nr, nc)) continue;
			const target = board[nr][nc];
			if (target && target.color !== color && target.type !== 'k') {
				if (nr === promoRow) {
					for (const promo of ['q', 'r', 'b', 'n'] as PieceType[]) {
						push(nr, nc, { promotion: promo });
					}
				} else {
					push(nr, nc);
				}
			}

			if (enPassant && enPassant.r === nr && enPassant.c === nc) {
				push(nr, nc, { isEnPassant: true });
			}
		}
	} else if (piece.type === 'n') {
		const deltas = [
			[-2, -1],
			[-2, 1],
			[-1, -2],
			[-1, 2],
			[1, -2],
			[1, 2],
			[2, -1],
			[2, 1]
		];
		for (const [dr, dc] of deltas) {
			const nr = r + dr;
			const nc = c + dc;
			if (!inBounds(nr, nc)) continue;
			const t = board[nr][nc];
			if (!t || (t.color !== color && t.type !== 'k')) push(nr, nc);
		}
	} else if (piece.type === 'k') {
		for (let dr = -1; dr <= 1; dr++) {
			for (let dc = -1; dc <= 1; dc++) {
				if (dr === 0 && dc === 0) continue;
				const nr = r + dr;
				const nc = c + dc;
				if (!inBounds(nr, nc)) continue;
				const t = board[nr][nc];
				if (!t || (t.color !== color && t.type !== 'k')) push(nr, nc);
			}
		}

		const homeRow = color === 'w' ? 7 : 0;
		if (r === homeRow && c === 4) {
			const enemy = opposite(color);
			const canK = color === 'w' ? castling.wK : castling.bK;
			const canQ = color === 'w' ? castling.wQ : castling.bQ;
			if (canK && !board[homeRow][5] && !board[homeRow][6]) {
				const rook = board[homeRow][7];
				if (rook && rook.type === 'r' && rook.color === color) {
					if (
						!isSquareAttacked(board, homeRow, 4, enemy) &&
						!isSquareAttacked(board, homeRow, 5, enemy) &&
						!isSquareAttacked(board, homeRow, 6, enemy)
					) {
						push(homeRow, 6, { isCastle: 'K' });
					}
				}
			}
			if (canQ && !board[homeRow][3] && !board[homeRow][2] && !board[homeRow][1]) {
				const rook = board[homeRow][0];
				if (rook && rook.type === 'r' && rook.color === color) {
					if (
						!isSquareAttacked(board, homeRow, 4, enemy) &&
						!isSquareAttacked(board, homeRow, 3, enemy) &&
						!isSquareAttacked(board, homeRow, 2, enemy)
					) {
						push(homeRow, 2, { isCastle: 'Q' });
					}
				}
			}
		}
	} else {
		const dirs: number[][] =
			piece.type === 'b'
				? [
						[-1, -1],
						[-1, 1],
						[1, -1],
						[1, 1]
					]
				: piece.type === 'r'
					? [
							[-1, 0],
							[1, 0],
							[0, -1],
							[0, 1]
						]
					: [
							[-1, -1],
							[-1, 1],
							[1, -1],
							[1, 1],
							[-1, 0],
							[1, 0],
							[0, -1],
							[0, 1]
						];
		for (const [dr, dc] of dirs) {
			let nr = r + dr;
			let nc = c + dc;
			while (inBounds(nr, nc)) {
				const t = board[nr][nc];
				if (!t) {
					push(nr, nc);
				} else {
					if (t.color !== color && t.type !== 'k') push(nr, nc);
					break;
				}
				nr += dr;
				nc += dc;
			}
		}
	}
	return moves;
}

function applyMoveRaw(state: GameState, m: Move): GameState {
	const next = cloneState(state);
	const piece = next.board[m.fromR][m.fromC];
	if (!piece) return next;
	const captured = next.board[m.toR][m.toC];

	if (m.isEnPassant) {
		const dir = piece.color === 'w' ? 1 : -1;
		next.board[m.toR + dir][m.toC] = null;
	}

	next.board[m.toR][m.toC] = m.promotion ? { type: m.promotion, color: piece.color } : piece;
	next.board[m.fromR][m.fromC] = null;

	if (m.isCastle) {
		const homeRow = piece.color === 'w' ? 7 : 0;
		if (m.isCastle === 'K') {
			next.board[homeRow][5] = next.board[homeRow][7];
			next.board[homeRow][7] = null;
		} else {
			next.board[homeRow][3] = next.board[homeRow][0];
			next.board[homeRow][0] = null;
		}
	}

	if (piece.type === 'k') {
		if (piece.color === 'w') {
			next.castling.wK = false;
			next.castling.wQ = false;
		} else {
			next.castling.bK = false;
			next.castling.bQ = false;
		}
	}
	const clearRookRight = (rr: number, cc: number) => {
		if (rr === 7 && cc === 0) next.castling.wQ = false;
		if (rr === 7 && cc === 7) next.castling.wK = false;
		if (rr === 0 && cc === 0) next.castling.bQ = false;
		if (rr === 0 && cc === 7) next.castling.bK = false;
	};
	clearRookRight(m.fromR, m.fromC);
	clearRookRight(m.toR, m.toC);

	if (piece.type === 'p' && Math.abs(m.toR - m.fromR) === 2) {
		next.enPassant = { r: (m.fromR + m.toR) / 2, c: m.fromC };
	} else {
		next.enPassant = null;
	}

	if (piece.type === 'p' || captured || m.isEnPassant) {
		next.halfmove = 0;
	} else {
		next.halfmove = state.halfmove + 1;
	}
	if (state.turn === 'b') next.fullmove = state.fullmove + 1;
	next.turn = opposite(state.turn);
	return next;
}

export function legalMovesForSquare(state: GameState, r: number, c: number): Move[] {
	const piece = state.board[r][c];
	if (!piece || piece.color !== state.turn) return [];
	const pseudos = pseudoMovesForSquare(state, r, c);
	return pseudos.filter((m) => {
		const next = applyMoveRaw(state, m);
		return !isInCheck(next, piece.color);
	});
}

export function allLegalMoves(state: GameState, color: PieceColor): Move[] {
	const scoped: GameState = { ...state, turn: color };
	const out: Move[] = [];
	for (let r = 0; r < 8; r++) {
		for (let c = 0; c < 8; c++) {
			const p = state.board[r][c];
			if (p && p.color === color) {
				out.push(...legalMovesForSquare(scoped, r, c));
			}
		}
	}
	return out;
}

export function applyMove(state: GameState, m: Move): GameState {
	return applyMoveRaw(state, m);
}

export type GameResult =
	| { over: false; inCheck: boolean }
	| { over: true; winner: PieceColor | null; reason: string; inCheck: boolean };

export function getGameResult(state: GameState): GameResult {
	const inCheck = isInCheck(state, state.turn);
	const moves = allLegalMoves(state, state.turn);
	if (moves.length === 0) {
		if (inCheck) {
			return {
				over: true,
				winner: opposite(state.turn),
				reason: 'Checkmate',
				inCheck
			};
		}
		return { over: true, winner: null, reason: 'Stalemate', inCheck };
	}
	if (state.halfmove >= 100) {
		return { over: true, winner: null, reason: 'Draw · fifty-move rule', inCheck };
	}
	if (isInsufficientMaterial(state.board)) {
		return { over: true, winner: null, reason: 'Draw · insufficient material', inCheck };
	}
	return { over: false, inCheck };
}

function isInsufficientMaterial(board: Board): boolean {
	const pieces: Piece[] = [];
	for (let r = 0; r < 8; r++) {
		for (let c = 0; c < 8; c++) {
			const p = board[r][c];
			if (p && p.type !== 'k') pieces.push(p);
		}
	}
	if (pieces.length === 0) return true;
	if (pieces.length === 1 && (pieces[0].type === 'b' || pieces[0].type === 'n')) {
		return true;
	}
	return false;
}

const PIECE_LETTER: Record<PieceType, string> = {
	k: 'K',
	q: 'Q',
	r: 'R',
	b: 'B',
	n: 'N',
	p: ''
};

export function moveToSan(state: GameState, m: Move): string {
	if (m.isCastle) return m.isCastle === 'K' ? 'O-O' : 'O-O-O';
	const piece = state.board[m.fromR][m.fromC];
	if (!piece) return squareName(m.toR, m.toC);
	const dest = squareName(m.toR, m.toC);
	const isCapture = state.board[m.toR][m.toC] !== null || m.isEnPassant === true;
	let san: string;
	if (piece.type === 'p') {
		san = isCapture ? `${FILES[m.fromC]}x${dest}` : dest;
		if (m.promotion) san += `=${PIECE_LETTER[m.promotion]}`;
	} else {
		const siblings: { fromR: number; fromC: number }[] = [];
		for (let r = 0; r < 8; r++) {
			for (let c = 0; c < 8; c++) {
				if (r === m.fromR && c === m.fromC) continue;
				const p = state.board[r][c];
				if (p && p.color === piece.color && p.type === piece.type) {
					const ms = legalMovesForSquare({ ...state, turn: piece.color }, r, c);
					if (ms.some((x) => x.toR === m.toR && x.toC === m.toC)) {
						siblings.push({ fromR: r, fromC: c });
					}
				}
			}
		}
		let disamb = '';
		if (siblings.length > 0) {
			const sameFile = siblings.some((s) => s.fromC === m.fromC);
			const sameRank = siblings.some((s) => s.fromR === m.fromR);
			if (!sameFile) disamb = FILES[m.fromC];
			else if (!sameRank) disamb = String(8 - m.fromR);
			else disamb = squareName(m.fromR, m.fromC);
		}
		san = `${PIECE_LETTER[piece.type]}${disamb}${isCapture ? 'x' : ''}${dest}`;
	}
	const next = applyMoveRaw(state, m);
	const enemy = next.turn;
	const enemyMoves = allLegalMoves(next, enemy);
	if (isInCheck(next, enemy)) {
		san += enemyMoves.length === 0 ? '#' : '+';
	}
	return san;
}
