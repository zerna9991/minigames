import { useEffect, useState, type ReactNode } from 'react';
import ChessBoard from './components/ChessBoard';
import HealthDot from './components/HealthDot';
import HistoryRoom from './components/HistoryRoom';
import InviteLobby from './components/InviteLobby';
import JoinRoom from './components/JoinRoom';
import PlayRoom from './components/PlayRoom';
import ProfileSidebar from './components/ProfileSidebar';
import WatchRoom from './components/WatchRoom';
import { useStudent } from './data/useStudent';
import type { HistoryEntry } from './net/history';
import {
	applyMove,
	createInitialState,
	moveToSan,
	type GameState,
	type Move,
	type Piece
} from './chess/engine';
import './App.css';
import PieceIcon from './components/PieceIcon';

function getParams(): URLSearchParams {
	return new URLSearchParams(window.location.search);
}

function makeGameId(): string {
	return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/* ---------------- Shared room chrome ---------------- */

function RoomShell(props: { sidebar: ReactNode; board: ReactNode; modal: ReactNode }) {
	return (
		<div className="page">
			<header className="topbar">
				<span className="brand">
					<span className="brand-mark">
						<PieceIcon color="b" type="n" className="brand-glyph" />
					</span>{' '}
					ACT Chess
				</span>
			</header>
			<div className="room-body">
				{props.sidebar}
				<main className="room-main">{props.board}</main>
			</div>
			{props.modal}
		</div>
	);
}

/* ---------------- Retired online room: BroadcastChannel path removed ---------------- */

function RetiredOnlineRoom({ legacyGameId }: { legacyGameId: string | null }) {
	return (
		<div className="page">
			<header className="topbar">
				<span className="brand">
					<span className="brand-mark">
						<PieceIcon color="b" type="n" className="brand-glyph" />
					</span>{' '}
					ACT Chess
				</span>
				<HealthDot />
			</header>
			<div className="room-body" style={{ justifyContent: 'center' }}>
				<div className="modal" style={{ maxWidth: 520 }}>
					<p className="eyebrow">Online play moved to the server</p>
					<h3>Shareable ?game= rooms are retired</h3>
					<p className="muted">
						Same-browser BroadcastChannel rooms
						{legacyGameId ? (
							<>
								{' '}
								(room <code>{legacyGameId}</code>)
							</>
						) : null}{' '}
						are retired. Online games now run on the backend: invite links, server-assigned colours,
						server-authoritative moves, clocks, and resign/timeout.
					</p>
					<div className="btn-row">
						<a className="btn primary big" href={`${window.location.pathname}?invite`}>
							Play online (invite)
						</a>
						<a className="btn secondary big" href={`${window.location.pathname}?local=1`}>
							Local 2-player
						</a>
					</div>
					<p className="hint">
						Flow: <code>?invite</code> to host, <code>?join=&lt;token&gt;</code> to accept,{' '}
						<code>?play=&lt;match_id&gt;</code> to play, <code>?watch=&lt;match_id&gt;</code> to
						spectate, <code>?history=&lt;student_id&gt;</code> for past games. Local same-screen
						play (<code>?local=1</code>) stays fully offline.
					</p>
				</div>
			</div>
		</div>
	);
}

/* ---------------- Local room: same screen, dual OK ---------------- */

function LocalRoom({
	gameId,
	whiteName,
	blackName
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
	const whiteStudent = useStudent(whiteName);
	const blackStudent = useStudent(blackName);

	function doMove(m: Move) {
		const san = moveToSan(game, m);
		const piece: Piece = game.board[m.fromR][m.fromC] ?? {
			type: 'p',
			color: game.turn
		};
		const captured: Piece | null = m.isEnPassant
			? { type: 'p', color: game.turn === 'w' ? 'b' : 'w' }
			: (game.board[m.toR][m.toC] ?? null);
		setGame(applyMove(game, m));
		setHistory((h) => [...h, { san, move: m, captured, piece }]);
		setLastMove(m);
	}

	return (
		<RoomShell
			sidebar={
				<ProfileSidebar
					top={{
						key: 'black',
						tag: 'Opponent · Black',
						firstName: blackStudent.firstName,
						lastName: blackStudent.lastName,
						faculty: blackStudent.faculty,
						group: blackStudent.group,
						photo: blackStudent.photo ?? null,
						colorLabel: 'Black',
						ready: blackOk,
						isTurn: bothReady && game.turn === 'b'
					}}
					bottom={{
						key: 'white',
						tag: 'You · White',
						firstName: whiteStudent.firstName,
						lastName: whiteStudent.lastName,
						faculty: whiteStudent.faculty,
						group: whiteStudent.group,
						photo: whiteStudent.photo ?? null,
						colorLabel: 'White',
						ready: whiteOk,
						isTurn: bothReady && game.turn === 'w'
					}}
				/>
			}
			board={
				<ChessBoard
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
					<div className="overlay" role="dialog" aria-modal="true" aria-label="Welcome">
						<div className="modal">
							<p className="eyebrow">ACT Chess · Room {gameId}</p>
							<h3>
								Welcome to ACT Chess, {whiteName} you are now playing with {blackName}
							</h3>
							<p className="muted">
								Each player presses their own OK. The board unlocks after both press OK — or skip it
								to test right now.
							</p>
							<div className="btn-row">
								<button
									type="button"
									className={`btn ${whiteOk ? 'secondary' : 'primary'}`}
									onClick={() => setWhiteOk(true)}
									disabled={whiteOk}
								>
									{whiteOk ? `${whiteName} ✓` : `${whiteName} · OK`}
								</button>
								<button
									type="button"
									className={`btn ${blackOk ? 'secondary' : 'primary'}`}
									onClick={() => setBlackOk(true)}
									disabled={blackOk}
								>
									{blackOk ? `${blackName} ✓` : `${blackName} · OK`}
								</button>
							</div>
							<button
								type="button"
								className="btn ghost big"
								onClick={() => {
									setWhiteOk(true);
									setBlackOk(true);
								}}
							>
								Start now (test mode)
							</button>
						</div>
					</div>
				) : undefined
			}
		/>
	);
}

/* ---------------- App: backend match flow + offline local ---------------- */

type Route =
	| { mode: 'local'; gameId: string; whiteName: string; blackName: string }
	| { mode: 'watch'; matchId: string }
	| { mode: 'play'; matchId: string }
	| { mode: 'invite'; studentId: string }
	| { mode: 'join'; token: string }
	| { mode: 'history'; studentId: string }
	| { mode: 'retired'; legacyGameId: string | null };

function initialRoute(): Route {
	const q = getParams();
	// Backend spectator slice (step 1): read-only live view of a server match.
	const watch = (q.get('watch') ?? '').trim();
	if (watch) return { mode: 'watch', matchId: watch };
	// Backend lobby slice (step 2): invitation issue + accept.
	// `?invite` (or `?invite=1`) hosts; `?join=<token>` accepts.
	// `&student_id=` (sent by the portal's Invite button) creates the link at once.
	if (q.has('invite')) return { mode: 'invite', studentId: (q.get('student_id') ?? '').trim() };
	const join = (q.get('join') ?? '').trim();
	if (join) return { mode: 'join', token: join };
	// Server-authoritative play (steps 3–4): `?play=<match_id>`.
	const play = (q.get('play') ?? '').trim();
	if (play) return { mode: 'play', matchId: play };
	// Match history (optional step 5): `?history` or `?history=<student_id>`.
	if (q.has('history')) return { mode: 'history', studentId: (q.get('history') ?? '').trim() };
	// Offline local room (kept): `?local=1`.
	if (q.get('local') === '1') {
		const game = (q.get('game') ?? '').trim().toUpperCase() || makeGameId();
		return {
			mode: 'local',
			gameId: game,
			whiteName: (q.get('white') ?? '').trim() || 'White',
			blackName: (q.get('black') ?? '').trim() || 'Black'
		};
	}
	// Retired: legacy BroadcastChannel online rooms (`?game=`, `?you=`,
	// `?solo=`, `?test=`, or bare root) now point at the backend match flow.
	const legacyGame = (q.get('game') ?? '').trim().toUpperCase() || null;
	return { mode: 'retired', legacyGameId: legacyGame };
}

export default function App() {
	const [route] = useState<Route>(initialRoute);

	// Keep the local room shareable: ensure the URL carries ?game=… + ?local=1.
	// Backend modes (watch/play/invite/join) and the retired notice own their
	// URLs — nothing to persist.
	useEffect(() => {
		if (route.mode !== 'local') return;
		if (!getParams().get('game')) {
			window.history.replaceState(
				null,
				'',
				`${window.location.pathname}?local=1&game=${route.gameId}`
			);
		}
	}, [route]);

	if (route.mode === 'watch') {
		return <WatchRoom matchId={route.matchId} />;
	}
	if (route.mode === 'play') {
		return <PlayRoom matchId={route.matchId} />;
	}
	if (route.mode === 'invite') {
		return <InviteLobby presetStudentId={route.studentId} />;
	}
	if (route.mode === 'join') {
		return <JoinRoom token={route.token} />;
	}
	if (route.mode === 'history') {
		return <HistoryRoom initialStudentId={route.studentId} />;
	}
	if (route.mode === 'local') {
		return (
			<LocalRoom gameId={route.gameId} whiteName={route.whiteName} blackName={route.blackName} />
		);
	}
	return <RetiredOnlineRoom legacyGameId={route.legacyGameId} />;
}
