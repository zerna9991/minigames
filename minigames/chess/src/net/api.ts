/**
 * Read-only backend client + invitation lobby + server-authoritative play.
 *
 * Step 1 (public, no auth): health / ongoing / completed reads + match SSE.
 * Step 2 (player credentials): invitation issue / accept / resume / cancel +
 *   invitation SSE + per-match game-session issue (the inviter's token path).
 * Steps 3–4 (player credentials + X-Game-Token): move posting, resign,
 *   timeout claims — see MatchOutcome + playMove/resignMatch/claimTimeout.
 */
import {
  applyMove,
  createInitialState,
  legalMovesForSquare,
  moveToSan,
  squareName,
  type Board,
  type GameState,
  type Move,
  type Piece,
  type PieceType,
} from "../chess/engine";
import type { HistoryEntry } from "./history";

export const API_BASE =
  (import.meta.env.VITE_CHESS_API as string | undefined)?.replace(/\/+$/, "") ||
  "https://act.gormadatyan.xyz/chess";

export type Side = "white" | "black";

export interface OngoingMatch {
  match_id: string;
  white_id: string;
  black_id: string;
  moves: string[];
  fen: string;
  turn: Side;
  ply: number;
  white_clock_ms: number;
  black_clock_ms: number;
  increment_ms: number;
  turn_started_at: string;
  started_at: string;
}

export interface CompletedMatch {
  match_id: string;
  white_id: string;
  black_id: string;
  result: Side | "draw";
  termination: string;
  winner_id: string | null;
  loser_id: string | null;
  ply: number;
  started_at: string;
  ended_at: string;
  settlement_state: string | null;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message || body.error);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error;
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    let code = "unknown";
    let message = `Request failed with ${res.status}`;
    try {
      const body = (await res.json()) as Partial<ApiErrorBody>;
      if (typeof body.error === "string") code = body.error;
      if (typeof body.message === "string") message = body.message;
    } catch {
      // non-JSON error body — keep the fallback
    }
    throw new ApiError(res.status, { error: code, message });
  }
  return (await res.json()) as T;
}

export function getHealth(): Promise<{ status: string }> {
  return apiGet<{ status: string }>("/health");
}

export function getOngoingMatch(matchId: string): Promise<OngoingMatch> {
  return apiGet<OngoingMatch>(
    `/api/v1/matches/ongoing/${encodeURIComponent(matchId)}`,
  );
}

export function getCompletedMatch(matchId: string): Promise<CompletedMatch> {
  return apiGet<CompletedMatch>(
    `/api/v1/matches/completed/${encodeURIComponent(matchId)}`,
  );
}

export interface MatchListOptions {
  limit?: number;
  offset?: number;
}

function matchListQuery(studentId?: string, opts?: MatchListOptions): string {
  const q = new URLSearchParams();
  if (studentId) q.set("student_id", studentId);
  if (opts?.limit !== undefined) q.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) q.set("offset", String(opts.offset));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function listOngoingMatches(
  studentId?: string,
  opts?: MatchListOptions,
): Promise<OngoingMatch[]> {
  return apiGet<OngoingMatch[]>(
    `/api/v1/matches/ongoing${matchListQuery(studentId, opts)}`,
  );
}

/** Finished games, newest-first (`ended_at` then `match_id`). Aborted matches
 *  never appear here — they are deleted, not recorded. */
export function listCompletedMatches(
  studentId?: string,
  opts?: MatchListOptions,
): Promise<CompletedMatch[]> {
  return apiGet<CompletedMatch[]>(
    `/api/v1/matches/completed${matchListQuery(studentId, opts)}`,
  );
}

/* ---------------- Player credentials + writes (step 2: lobby) ---------------- */

export interface PlayerIdentity {
  studentId: string;
  sessionToken: string;
}

export interface IssuedInvitation {
  token: string;
  watch_key: string;
  inviter_id: string;
  created_at: string;
  expires_at: string;
}

export interface InvitationInfo {
  inviter_id: string;
  watch_key: string;
  created_at: string;
  expires_at: string;
}

export interface GameSession {
  match_id: string;
  student_id: string;
  side: string;
  token: string;
  issued_at: string;
}

export interface StartedMatch {
  ongoing: OngoingMatch;
  session: GameSession;
}

function playerAuthHeaders(id: PlayerIdentity): Record<string, string> {
  return {
    Authorization: `Bearer ${id.sessionToken}`,
    "X-Student-Id": id.studentId,
  };
}

async function throwForStatus(res: Response): Promise<never> {
  let code = "unknown";
  let message = `Request failed with ${res.status}`;
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    if (typeof body.error === "string") code = body.error;
    if (typeof body.message === "string") message = body.message;
  } catch {
    // non-JSON error body — keep the fallback
  }
  throw new ApiError(res.status, { error: code, message });
}

/** Authed POST. No body → no Content-Type (bodies are strict; avoid 415). */
async function apiPost<T>(
  path: string,
  id: PlayerIdentity,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers:
      body === undefined
        ? { Accept: "application/json", ...playerAuthHeaders(id) }
        : {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...playerAuthHeaders(id),
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) return throwForStatus(res);
  return (await res.json()) as T;
}

async function apiGetAuthed<T>(path: string, id: PlayerIdentity): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json", ...playerAuthHeaders(id) },
  });
  if (!res.ok) return throwForStatus(res);
  return (await res.json()) as T;
}

/** Issue (or replace) my invitation link. Re-issuing revokes the previous one. */
export function issueInvitation(id: PlayerIdentity): Promise<IssuedInvitation> {
  return apiPost<IssuedInvitation>("/api/v1/invitations", id);
}

/** Accept a link token once → starts the match. Returns board + own game token. */
export function acceptInvitation(
  id: PlayerIdentity,
  token: string,
): Promise<StartedMatch> {
  return apiPost<StartedMatch>("/api/v1/invitations/accept", id, { token });
}

/** Resume a waiting screen after reload (200) or 404 when there is none. */
export function getMyInvitation(id: PlayerIdentity): Promise<InvitationInfo> {
  return apiGetAuthed<InvitationInfo>("/api/v1/invitations/me", id);
}

/** Cancel my open invitation (204). Watchers get a `cancelled` event. */
export async function cancelMyInvitation(id: PlayerIdentity): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/invitations/me`, {
    method: "DELETE",
    headers: { Accept: "application/json", ...playerAuthHeaders(id) },
  });
  if (!res.ok) return throwForStatus(res);
}

/** Inviter's path to a game token after the invitation stream says `accepted`. */
export function issueGameSession(
  id: PlayerIdentity,
  matchId: string,
): Promise<GameSession> {
  return apiPost<GameSession>(
    `/api/v1/matches/ongoing/${encodeURIComponent(matchId)}/session`,
    id,
  );
}

export interface InvitationStreamHandlers {
  onWaiting: () => void;
  onAccepted: (matchId: string) => void;
  onCancelled: () => void;
  onReplaced: () => void;
  onExpired: () => void;
  onError?: () => void;
}

/**
 * Watch one invitation by its public `watch_key` (no headers — the key is the
 * capability). Opens with one `waiting` frame, then exactly one terminal frame
 * (`accepted|cancelled|replaced|expired`) and the server closes the stream.
 * A `404` (already accepted/cancelled/replaced/expired) surfaces as `onError`
 * — the caller should then check `GET /matches/ongoing?student_id=…` since the
 * match may already exist.
 */
export function watchInvitation(
  watchKey: string,
  handlers: InvitationStreamHandlers,
): () => void {
  const es = new EventSource(
    `${API_BASE}/api/v1/invitations/watch/${encodeURIComponent(watchKey)}/events`,
  );
  // The server closes the stream after the terminal frame; close our side
  // too, or `EventSource` auto-reconnects and reports a spurious error.
  let done = false;
  const terminal = (fn: () => void) => {
    done = true;
    es.close();
    fn();
  };
  es.addEventListener("waiting", () => handlers.onWaiting());
  es.addEventListener("accepted", (e) => {
    const matchId = parseData(e)?.match_id;
    terminal(() => handlers.onAccepted(typeof matchId === "string" ? matchId : ""));
  });
  es.addEventListener("cancelled", () => terminal(handlers.onCancelled));
  es.addEventListener("replaced", () => terminal(handlers.onReplaced));
  es.addEventListener("expired", () => terminal(handlers.onExpired));
  es.onerror = () => {
    if (done) return;
    // Hand over to the caller's fallback instead of letting the browser
    // retry the same URL forever (e.g. a 404 for a consumed invitation).
    done = true;
    es.close();
    handlers.onError?.();
  };
  return () => {
    done = true;
    es.close();
  };
}

/* ---------------- Server-authoritative play (steps 3–4) ---------------- */

export type MatchStatus = "ongoing" | "completed" | "aborted";

/**
 * Envelope returned by every write (move / resign / timeout). Exactly one of
 * `ongoing` / `completed` is set — except `aborted`, where both are null
 * (match deleted before both sides moved: no result, no points).
 */
export interface MatchOutcome {
  match_id: string;
  status: MatchStatus;
  ongoing: OngoingMatch | null;
  completed: CompletedMatch | null;
}

function gameTokenHeaders(
  id: PlayerIdentity,
  gameToken: string,
): Record<string, string> {
  return { ...playerAuthHeaders(id), "X-Game-Token": gameToken };
}

/** Authed POST with a per-match game token (moves / resign / timeout). */
async function apiPostGame<T>(
  path: string,
  id: PlayerIdentity,
  gameToken: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers:
      body === undefined
        ? { Accept: "application/json", ...gameTokenHeaders(id, gameToken) }
        : {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...gameTokenHeaders(id, gameToken),
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) return throwForStatus(res);
  return (await res.json()) as T;
}

/**
 * Play a move. Always send `ply` (the board you moved on) so the server can
 * reject stale boards with 409 instead of applying to the wrong position.
 */
export function playMove(
  id: PlayerIdentity,
  gameToken: string,
  matchId: string,
  uci: string,
  ply: number,
): Promise<MatchOutcome> {
  return apiPostGame<MatchOutcome>(
    `/api/v1/matches/ongoing/${encodeURIComponent(matchId)}/moves`,
    id,
    gameToken,
    { uci, ply },
  );
}

/** Resign — the opponent wins (aborts when both sides haven't moved yet). */
export function resignMatch(
  id: PlayerIdentity,
  gameToken: string,
  matchId: string,
): Promise<MatchOutcome> {
  return apiPostGame<MatchOutcome>(
    `/api/v1/matches/ongoing/${encodeURIComponent(matchId)}/resign`,
    id,
    gameToken,
  );
}

/**
 * Claim a win on time. Either player may call it; 409 while time remains.
 * Aborts (deletes) before both sides moved.
 */
export function claimTimeout(
  id: PlayerIdentity,
  gameToken: string,
  matchId: string,
): Promise<MatchOutcome> {
  return apiPostGame<MatchOutcome>(
    `/api/v1/matches/ongoing/${encodeURIComponent(matchId)}/timeout`,
    id,
    gameToken,
  );
}

/* ---------------- UCI ↔ engine Move ---------------- */

const UCI_RE = /^([a-h])([1-8])([a-h])([1-8])([qrbn])?$/;

/** Serialize a local engine Move to server UCI (castling as king move). */
export function moveToUci(m: Move): string {
  const base = `${squareName(m.fromR, m.fromC)}${squareName(m.toR, m.toC)}`;
  return m.promotion ? `${base}${m.promotion}` : base;
}

function squareToRC(file: string, rank: string): { r: number; c: number } {
  return { r: 8 - Number(rank), c: file.charCodeAt(0) - 97 };
}

/**
 * Resolve a server UCI string to a local engine Move by matching it against
 * the position's legal moves. Matching (instead of constructing) recovers
 * castling / en-passant flags and the exact promotion piece.
 */
export function uciToMove(state: GameState, uci: string): Move | null {
  const m = UCI_RE.exec(uci.trim());
  if (!m) return null;
  const from = squareToRC(m[1], m[2]);
  const to = squareToRC(m[3], m[4]);
  const promo = (m[5] ?? undefined) as PieceType | undefined;
  const candidates = legalMovesForSquare(state, from.r, from.c);
  const exact = candidates.find(
    (c) => c.toR === to.r && c.toC === to.c && (c.promotion ?? undefined) === promo,
  );
  if (exact) return exact;
  return candidates.find((c) => c.toR === to.r && c.toC === to.c) ?? null;
}

/* ---------------- FEN → GameState ---------------- */

const FEN_PIECE: Record<string, PieceType> = {
  k: "k",
  q: "q",
  r: "r",
  b: "b",
  n: "n",
  p: "p",
};

/** Parse a FEN string into a renderable GameState. Returns null when malformed. */
export function parseFen(fen: string): GameState | null {
  try {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const rows = parts[0].split("/");
    if (rows.length !== 8) return null;
    const board: Board = [];
    for (const row of rows) {
      const rank: (Piece | null)[] = [];
      for (const ch of row) {
        if (ch >= "1" && ch <= "8") {
          for (let i = 0; i < Number(ch); i++) rank.push(null);
        } else {
          const type = FEN_PIECE[ch.toLowerCase()];
          if (!type) return null;
          rank.push({ type, color: ch === ch.toUpperCase() ? "w" : "b" });
        }
      }
      if (rank.length !== 8) return null;
      board.push(rank);
    }
    const turn = parts[1] === "b" ? "b" : "w";
    const cast = parts[2] ?? "-";
    let enPassant: GameState["enPassant"] = null;
    if (parts[3] && parts[3] !== "-") {
      const c = parts[3].charCodeAt(0) - 97;
      const rank = Number(parts[3].slice(1));
      if (c >= 0 && c < 8 && rank >= 1 && rank <= 8) {
        enPassant = { r: 8 - rank, c };
      }
    }
    return {
      board,
      turn,
      castling: {
        wK: cast.includes("K"),
        wQ: cast.includes("Q"),
        bK: cast.includes("k"),
        bQ: cast.includes("q"),
      },
      enPassant,
      halfmove: Number(parts[4] ?? 0) || 0,
      fullmove: Number(parts[5] ?? 1) || 1,
    };
  } catch {
    return null;
  }
}

/* ---------------- Server state → view ---------------- */

export interface MatchView {
  game: GameState;
  history: HistoryEntry[];
  lastMove: Move | null;
}

/**
 * Build a renderable view from an OngoingMatch: the board comes from the
 * authoritative FEN; SAN history is derived by replaying the UCI move list
 * through the local engine (best-effort — stops at the first unresolvable move).
 */
export function buildView(ongoing: OngoingMatch): MatchView | null {
  const game = parseFen(ongoing.fen);
  if (!game) return null;
  let state = createInitialState();
  const history: HistoryEntry[] = [];
  let lastMove: Move | null = null;
  for (const uci of ongoing.moves) {
    const mv = uciToMove(state, uci);
    if (!mv) break;
    const san = moveToSan(state, mv);
    const piece: Piece = state.board[mv.fromR][mv.fromC] ?? {
      type: "p",
      color: state.turn,
    };
    const captured: Piece | null = mv.isEnPassant
      ? { type: "p", color: state.turn === "w" ? "b" : "w" }
      : (state.board[mv.toR][mv.toC] ?? null);
    state = applyMove(state, mv);
    history.push({ san, move: mv, captured, piece });
    lastMove = mv;
  }
  return { game, history, lastMove };
}

/* ---------------- Match event stream (SSE) ---------------- */

export interface MatchStreamHandlers {
  onSnapshot: (match: OngoingMatch) => void;
  onMove: (match: OngoingMatch, uci: string) => void;
  onGameOver: (match: CompletedMatch) => void;
  onAborted: (matchId: string) => void;
  onError?: () => void;
}

function parseData(e: Event): Record<string, unknown> | null {
  try {
    return JSON.parse((e as MessageEvent).data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Open the public match stream. Every event carries full state, so each
 * handler just replaces the current view. Returns an unsubscribe function.
 * Note: `Last-Event-ID` resumption is not supported by the server — a
 * reconnect simply re-snapshots.
 */
export function watchMatch(
  matchId: string,
  handlers: MatchStreamHandlers,
): () => void {
  const es = new EventSource(
    `${API_BASE}/api/v1/matches/ongoing/${encodeURIComponent(matchId)}/events`,
  );
  const isOngoing = (v: unknown): v is OngoingMatch =>
    typeof v === "object" && v !== null && "fen" in v && "moves" in v;
  const isCompleted = (v: unknown): v is CompletedMatch =>
    typeof v === "object" && v !== null && "result" in v && "ended_at" in v;

  es.addEventListener("snapshot", (e) => {
    const ongoing = parseData(e)?.ongoing;
    if (isOngoing(ongoing)) handlers.onSnapshot(ongoing);
  });
  es.addEventListener("move", (e) => {
    const data = parseData(e);
    const ongoing = data?.ongoing;
    if (isOngoing(ongoing)) {
      handlers.onMove(ongoing, typeof data?.uci === "string" ? data.uci : "");
    }
  });
  // The server closes the stream after `game_over`/`aborted`. Close our side
  // on the terminal frame, or `EventSource` auto-reconnects, the server
  // replays the final event, closes again, and so on forever.
  let done = false;
  const close = () => {
    done = true;
    es.close();
  };
  es.addEventListener("game_over", (e) => {
    const completed = parseData(e)?.completed;
    close();
    if (isCompleted(completed)) handlers.onGameOver(completed);
  });
  es.addEventListener("aborted", (e) => {
    const id = parseData(e)?.match_id;
    close();
    handlers.onAborted(typeof id === "string" ? id : matchId);
  });
  es.onerror = () => {
    if (done) return;
    // Hand over to the caller's polling fallback rather than running the
    // browser's auto-reconnect alongside it.
    close();
    handlers.onError?.();
  };
  return close;
}

/* ----------- GET-polling fallback (503 >200-watchers path) ----------- */

/**
 * Fallback when an SSE stream is refused (`503` — >200 watchers on that
 * match/invitation) or drops. `EventSource` never surfaces the HTTP status,
 * so every stream `onError` degrades to plain `GET` polling here instead of
 * asking the user to reload: poll `GET ongoing/{id}` (404 → `GET
 * completed/{id}` for the final result, 404 there too → aborted) and feed
 * the same handler shape as `watchMatch`. Stops by itself after a terminal
 * result. Returns an unsubscribe function.
 */
export function pollMatch(
  matchId: string,
  handlers: MatchStreamHandlers,
  intervalMs = 3000,
): () => void {
  let stopped = false;
  let timer: number | null = null;
  const stop = () => {
    stopped = true;
    if (timer !== null) window.clearInterval(timer);
  };
  const tick = async () => {
    try {
      const ongoing = await getOngoingMatch(matchId);
      if (!stopped) handlers.onSnapshot(ongoing);
    } catch (err) {
      if (stopped) return;
      if (err instanceof ApiError && err.status === 404) {
        try {
          const completed = await getCompletedMatch(matchId);
          if (stopped) return;
          stop();
          handlers.onGameOver(completed);
          return;
        } catch (err2) {
          if (stopped) return;
          // Gone from both lists: aborted matches are deleted, not recorded.
          if (err2 instanceof ApiError && err2.status === 404) {
            stop();
            handlers.onAborted(matchId);
            return;
          }
          // otherwise fall through to onError below
        }
      }
      handlers.onError?.();
    }
  };
  void tick();
  timer = window.setInterval(() => void tick(), intervalMs);
  return stop;
}

/**
 * Invitation-side equivalent of `pollMatch`: poll
 * `GET ongoing?student_id=` until a match appears (the spec's prescribed
 * fallback when the invitation stream answers `503`). Calls `onMatch` on the
 * first hit so the caller can hand off to `?play=`.
 */
export function pollInvitationForMatch(
  identity: PlayerIdentity,
  onMatch: (matchId: string) => void,
  intervalMs = 4000,
): () => void {
  let stopped = false;
  let timer: number | null = null;
  const tick = async () => {
    try {
      const list = await listOngoingMatches(identity.studentId.trim(), { limit: 1 });
      if (stopped) return;
      if (list.length > 0) onMatch(list[0].match_id);
    } catch {
      // transient — keep polling; explicit cancel/expire still arrives via
      // `GET /invitations/me` checks in the caller.
    }
  };
  void tick();
  timer = window.setInterval(() => void tick(), intervalMs);
  return () => {
    stopped = true;
    if (timer !== null) window.clearInterval(timer);
  };
}
