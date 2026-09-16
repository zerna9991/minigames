import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMove,
  createInitialState,
  moveToSan,
  type GameState,
  type Move,
  type Piece,
} from '../chess/engine';

export interface HistoryEntry {
  san: string;
  move: Move;
  captured: Piece | null;
}

export type SeatColor = 'w' | 'b';

interface PeerInfo {
  id: string;
  name: string;
  color: SeatColor | null;
  ready: boolean;
  lastSeen: number;
}

type Msg =
  | { kind: 'hello'; id: string; name: string; color: SeatColor | null; ready: boolean; ts: number }
  | { kind: 'bye'; id: string }
  | { kind: 'ready'; id: string; name: string; ready: boolean }
  | { kind: 'move'; id: string; move: Move }
  | { kind: 'sync-request'; id: string }
  | {
      kind: 'sync-state';
      id: string;
      game: GameState;
      history: HistoryEntry[];
      lastMove: Move | null;
    };

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function seatsKey(gameId: string): string {
  return `act-chess-${gameId}-seats`;
}

interface Seats {
  white?: { id: string; name: string; ts: number };
  black?: { id: string; name: string; ts: number };
}

function readSeats(gameId: string): Seats {
  try {
    const raw = localStorage.getItem(seatsKey(gameId));
    if (!raw) return {};
    return JSON.parse(raw) as Seats;
  } catch {
    return {};
  }
}

function writeSeats(gameId: string, seats: Seats): void {
  try {
    localStorage.setItem(seatsKey(gameId), JSON.stringify(seats));
  } catch {
    // storage unavailable — presence still works over BroadcastChannel
  }
}

/** Claim a color seat for this tab (same-browser tabs share localStorage). */
function claimSeat(gameId: string, clientId: string, name: string): SeatColor | null {
  const seats = readSeats(gameId);
  const now = Date.now();
  const stale = (ts?: number) => !ts || now - ts > 120_000;
  if (!seats.white || seats.white.id === clientId || stale(seats.white.ts)) {
    writeSeats(gameId, { ...seats, white: { id: clientId, name, ts: now } });
    return 'w';
  }
  if (!seats.black || seats.black.id === clientId || stale(seats.black.ts)) {
    writeSeats(gameId, { ...seats, black: { id: clientId, name, ts: now } });
    return 'b';
  }
  if (seats.white.id === clientId) return 'w';
  if (seats.black.id === clientId) return 'b';
  return null; // room full — spectator
}

function touchSeat(gameId: string, clientId: string, color: SeatColor | null, name: string): void {
  if (!color) return;
  const seats = readSeats(gameId);
  const entry = color === 'w' ? seats.white : seats.black;
  if (entry && entry.id !== clientId) return; // someone else holds it
  writeSeats(gameId, {
    ...seats,
    [color === 'w' ? 'white' : 'black']: { id: clientId, name, ts: Date.now() },
  });
}

function releaseSeat(gameId: string, clientId: string): void {
  const seats = readSeats(gameId);
  let changed = false;
  if (seats.white?.id === clientId) {
    delete seats.white;
    changed = true;
  }
  if (seats.black?.id === clientId) {
    delete seats.black;
    changed = true;
  }
  if (changed) writeSeats(gameId, seats);
}

export interface SyncedGame {
  myColor: SeatColor | null;
  opponent: PeerInfo | null;
  bothJoined: boolean;
  myReady: boolean;
  opponentReady: boolean;
  bothReady: boolean;
  game: GameState;
  history: HistoryEntry[];
  lastMove: Move | null;
  pressReady: () => void;
  doMove: (m: Move) => void;
}

/**
 * Two-player room sync over BroadcastChannel (works across tabs/windows of
 * the same browser + origin) with localStorage seat claims so the two tabs
 * get opposite colors. Structured so the transport can later be swapped for
 * a WebSocket server for cross-device play without touching the UI.
 */
export function useSyncedGame(gameId: string, myName: string): SyncedGame {
  const [clientId] = useState(randomId);
  const [myColor, setMyColor] = useState<SeatColor | null>(null);
  const [peers, setPeers] = useState<Record<string, PeerInfo>>({});
  const [myReady, setMyReady] = useState(false);
  const [game, setGame] = useState<GameState>(() => createInitialState());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [lastMove, setLastMove] = useState<Move | null>(null);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const stateRef = useRef({ game, history, lastMove, myReady, myColor, myName });
  stateRef.current = { game, history, lastMove, myReady, myColor, myName };

  // Claim a seat once per room.
  useEffect(() => {
    const color = claimSeat(gameId, clientId, myName);
    setMyColor(color);
    const onUnload = () => releaseSeat(gameId, clientId);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      releaseSeat(gameId, clientId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, clientId]);

  // Keep seat name fresh.
  useEffect(() => {
    touchSeat(gameId, clientId, myColor, myName);
  }, [gameId, clientId, myColor, myName]);

  const send = useCallback(
    (msg: Msg) => {
      try {
        channelRef.current?.postMessage(msg);
      } catch {
        // channel closed — local play still works
      }
    },
    [],
  );

  const applyRemoteMove = useCallback((m: Move) => {
    const s = stateRef.current;
    // Ignore moves for a game state we already advanced past.
    const san = moveToSan(s.game, m);
    const captured: Piece | null = m.isEnPassant
      ? { type: 'p', color: s.game.turn === 'w' ? 'b' : 'w' }
      : (s.game.board[m.toR][m.toC] ?? null);
    try {
      const next = applyMove(s.game, m);
      setGame(next);
      setHistory((h) => [...h, { san, move: m, captured }]);
      setLastMove(m);
    } catch {
      // illegal / out-of-order move — ignore, request full sync below
      channelRef.current?.postMessage({ kind: 'sync-request', id: s.myName } satisfies Msg);
    }
  }, []);

  // Channel setup + hello loop + pruning.
  useEffect(() => {
    const channel = new BroadcastChannel(`act-chess-${gameId}`);
    channelRef.current = channel;

    channel.onmessage = (ev: MessageEvent<Msg>) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if ('id' in msg && msg.id === clientId) return;
      const now = Date.now();

      switch (msg.kind) {
        case 'hello': {
          setPeers((prev) => ({
            ...prev,
            [msg.id]: {
              id: msg.id,
              name: msg.name,
              color: msg.color,
              ready: msg.ready || prev[msg.id]?.ready || false,
              lastSeen: now,
            },
          }));
          // Color conflict: both claimed same color → lower clientId keeps it.
          if (
            msg.color &&
            stateRef.current.myColor &&
            msg.color === stateRef.current.myColor &&
            msg.id < clientId
          ) {
            const fallback: SeatColor | null =
              stateRef.current.myColor === 'w' ? 'b' : 'w';
            setMyColor(fallback);
            touchSeat(gameId, clientId, fallback, stateRef.current.myName);
          }
          // Late joiner asked implicitly — if we have moves, share full state.
          if (stateRef.current.history.length > 0) {
            const s = stateRef.current;
            channel.postMessage({
              kind: 'sync-state',
              id: clientId,
              game: s.game,
              history: s.history,
              lastMove: s.lastMove,
            } satisfies Msg);
          }
          break;
        }
        case 'bye': {
          setPeers((prev) => {
            const next = { ...prev };
            delete next[msg.id];
            return next;
          });
          break;
        }
        case 'ready': {
          setPeers((prev) => ({
            ...prev,
            [msg.id]: {
              id: msg.id,
              name: msg.name,
              color: prev[msg.id]?.color ?? null,
              ready: msg.ready,
              lastSeen: now,
            },
          }));
          break;
        }
        case 'move': {
          applyRemoteMove(msg.move);
          break;
        }
        case 'sync-request': {
          const s = stateRef.current;
          if (s.history.length > 0) {
            channel.postMessage({
              kind: 'sync-state',
              id: clientId,
              game: s.game,
              history: s.history,
              lastMove: s.lastMove,
            } satisfies Msg);
          }
          break;
        }
        case 'sync-state': {
          // Adopt only if the sender is ahead of us.
          if (msg.history.length > stateRef.current.history.length) {
            setGame(msg.game);
            setHistory(msg.history);
            setLastMove(msg.lastMove);
          }
          break;
        }
      }
    };

    const sayHello = () => {
      const s = stateRef.current;
      channel.postMessage({
        kind: 'hello',
        id: clientId,
        name: s.myName,
        color: s.myColor,
        ready: s.myReady,
        ts: Date.now(),
      } satisfies Msg);
    };
    sayHello();
    // Ask for state in case we joined mid-game.
    channel.postMessage({ kind: 'sync-request', id: clientId } satisfies Msg);

    const helloTimer = window.setInterval(sayHello, 1500);
    const pruneTimer = window.setInterval(() => {
      setPeers((prev) => {
        const cutoff = Date.now() - 6000;
        let changed = false;
        const next = { ...prev };
        for (const [id, p] of Object.entries(next)) {
          if (p.lastSeen < cutoff) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 2000);

    return () => {
      window.clearInterval(helloTimer);
      window.clearInterval(pruneTimer);
      try {
        channel.postMessage({ kind: 'bye', id: clientId } satisfies Msg);
      } catch {
        // ignore
      }
      channel.close();
      channelRef.current = null;
    };
  }, [gameId, clientId, applyRemoteMove]);

  const pressReady = useCallback(() => {
    if (stateRef.current.myReady) return;
    setMyReady(true);
    send({ kind: 'ready', id: clientId, name: stateRef.current.myName, ready: true });
  }, [clientId, send]);

  const doMove = useCallback(
    (m: Move) => {
      const s = stateRef.current;
      const san = moveToSan(s.game, m);
      const captured: Piece | null = m.isEnPassant
        ? { type: 'p', color: s.game.turn === 'w' ? 'b' : 'w' }
        : (s.game.board[m.toR][m.toC] ?? null);
      setGame(applyMove(s.game, m));
      setHistory((h) => [...h, { san, move: m, captured }]);
      setLastMove(m);
      send({ kind: 'move', id: clientId, move: m });
    },
    [clientId, send],
  );

  const peerList = useMemo(() => Object.values(peers), [peers]);
  const opponent = useMemo<PeerInfo | null>(() => {
    if (peerList.length === 0) return null;
    // Prefer the peer holding the opposite color; else most recently seen.
    const opposite = myColor === 'w' ? 'b' : myColor === 'b' ? 'w' : null;
    const match = opposite ? peerList.find((p) => p.color === opposite) : undefined;
    if (match) return match;
    return [...peerList].sort((a, b) => b.lastSeen - a.lastSeen)[0];
  }, [peerList, myColor]);

  const bothJoined = opponent !== null;
  const opponentReady = opponent?.ready ?? false;
  const bothReady = myReady && opponentReady && bothJoined;

  return {
    myColor,
    opponent,
    bothJoined,
    myReady,
    opponentReady,
    bothReady,
    game,
    history,
    lastMove,
    pressReady,
    doMove,
  };
}
