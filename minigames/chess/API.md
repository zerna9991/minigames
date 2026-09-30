# Chess Minigame — Backend API Guide & Frontend Match Analysis

> Source: `GET /api-docs/openapi.json` (OpenAPI 3.1.0, version `0.1.0`,
> title `chess-minigame API`).
> Docs endpoints require the static admin token (`ADMIN_TOKEN`) as
> `Authorization: Bearer <ADMIN_TOKEN>`. Keep the real value in an env var /
> secret store — do not commit it.
>
> Live service: `https://act.gormadatyan.xyz/chess`
> Local dev server per spec: `http://127.0.0.1:3002` (`PORT` overrides 3002).
> All game paths below are prefixed with `/api/v1`.

This file is written for the coding agent: Part 1 is a faithful, detailed
usage manual for the backend; Part 2 maps every API concept onto the current
Vite + React frontend in `minigames/chess/src` and lists exactly what must
change to adopt the backend.

---

## Part 1 — API usage

### 1.1 What the backend owns

- **Invitations**: one open invitation per student, single-use link token,
  24 h expiry. Issuing again replaces the old one.
- **Server-authoritative games**: the server owns the board, clocks, and
  results. Clients send UCI moves; the server validates legality and detects
  checkmate / stalemate / insufficient material / threefold repetition /
  fifty-move rule automatically.
- **Results**: each completed match's points are delivered to sport-tracking's
  ledger (`PUT /api/v1/matches/chess/{match_id}`) from an outbox written in
  the same transaction that ends the match. This service stores only student
  IDs; names/photos come from the student portal.
- **Its own SQLite database; REST over JSON** plus two SSE streams (no
  WebSockets, no polling).

### 1.2 Authentication matrix

| Operation                                                                                                                         | Credentials                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`, `GET /api/v1/matches/…` (reads + lists), both SSE streams                                                          | Public, none                                                                                                                                                                     |
| Invitations (`POST /invitations`, `POST /invitations/accept`, `GET/DELETE /invitations/me`), `POST /matches/ongoing/{id}/session` | Player credentials                                                                                                                                                               |
| Moves, resignations, timeout claims                                                                                               | Player credentials **+ `X-Game-Token`**                                                                                                                                          |
| `POST /api/v1/matches/completed/{match_id}/void` and `…/requeue`                                                                  | Static admin token (`ADMIN_TOKEN`), as `Authorization: Bearer <token>` **or** `X-Admin-Token: <token>` (either works; with no `ADMIN_TOKEN` configured they always answer `401`) |
| `GET /api-docs`, `GET /api-docs/openapi.json`                                                                                     | `Authorization: Bearer <ADMIN_TOKEN>`                                                                                                                                            |

Player credentials = **both** headers together:

```http
Authorization: Bearer <portal-session-token>
X-Student-Id: CS0103125
```

Notes:

- **Session tokens are currently NOT verified**: any non-blank token is
  accepted for any well-formed student ID. The per-match game token is what
  actually protects games (see §1.3).
- Credentials are checked **before** path/body parsing, so a missing/bad
  credential returns `401` even if the request is also malformed.
- Student IDs match `^(CS|EM|DA)\d{7}$`. Match IDs are ULIDs
  (`^[A-Za-z0-9._:-]{1,64}$`), shared with sport-tracking.
- Request bodies are **strict**: unknown fields → `422`. Bodies > 2 MB →
  `413`. JSON without `Content-Type: application/json` → `415`.
- Empty query values count as omitted. Pagination: `limit` default 50,
  clamped to `1..=200`; `offset` default 0, `>= 0`. List endpoints return a
  **bare JSON array** (no envelope, no total) — page until a response is
  shorter than `limit`.
- Timestamps are ISO-8601 UTC with millis, e.g. `2026-09-15T16:00:00.000Z`.
- Error shape is always `ErrorBody`: `{ "error": "<code>", "message": "..." }`.
  Branch on `error`, not `message`. See §1.8 for the table.

### 1.3 Game session tokens (`X-Game-Token`)

A second credential scoped to **one student in one match**, required on every
move / resign / timeout claim (never on reads or streams):

```http
X-Game-Token: <game-session-token>
```

- Issued by `POST /matches/ongoing/{match_id}/session` (inviter's path —
  only the match's two players may call it).
- The **accepter** gets theirs directly in the `POST /invitations/accept`
  `201` response (`StartedMatch.session`) — no extra call.
- Shown **once** (only SHA-256 stored). Re-issuing **replaces** it: the old
  token stops working immediately (revocation / recovery). Never affects the
  opponent's token. Dies with the match.

### 1.4 Endpoint reference

#### `GET /health` — liveness probe (public)

`200` → `Health` schema. Use for readiness checks; needs no auth.

#### Invitations (all need player credentials except the stream)

**`POST /api/v1/invitations` — issue (or replace) your invitation link**
(`operationId: issueInvitation`)

- No body. Returns `201 IssuedInvitation`:
  ```json
  {
  	"token": "q3Jx0cK1vVb8m2Zp9LwY4tR7nE6sH5dA1fG0jU3iO2k",
  	"watch_key": "8pQ2fV0sYkq3mXc7RzB1oN4tJ6hL9dGwA5uE2iT0yS8",
  	"inviter_id": "CS0103125",
  	"created_at": "2026-09-15T16:00:00.000Z",
  	"expires_at": "2026-09-16T16:00:00.000Z"
  }
  ```
- `token` (43-char base64url) is returned **only here** — embed it in the
  share link the friend opens. `watch_key` (SHA-256 of the token) goes to the
  invitation SSE stream.
- One open invitation per student: re-issuing revokes the previous link and
  its watchers get a `replaced` event. `403` if caller isn't in the student
  portal; `502` if the portal is unreachable.

**`POST /api/v1/invitations/accept` — accept and start the match**
(`acceptInvitation`, player credentials)

```json
{ "token": "q3Jx0cK1vVb8m2Zp9LwY4tR7nE6sH5dA1fG0jU3iO2k" }
```

- Consumes the link **exactly once** (unknown/used/cancelled/replaced/expired
  → indistinguishable `404`), starts a match in the same transaction.
- Colours assigned **at random**; each side 10 min + 5 s/move; white's clock
  runs from match start.
- Returns `201 StartedMatch`: `{ "ongoing": {…OngoingMatch…}, "session": {…GameSession…} }`.
  The accepter's page should open the board **immediately** from this
  response (it already has its game token).
- `409` if you accept your own invitation.

**`GET /api/v1/invitations/me` — get your open invitation** (`getMyInvitation`)
→ `200 Invitation` (`inviter_id, watch_key, created_at, expires_at` — **no**
`token`; re-issue to re-share) or `404` if none. Used to resume a waiting
screen after reload.

**`DELETE /api/v1/invitations/me` — cancel it** (`cancelMyInvitation`)
→ `204` empty; watchers get `cancelled`. `404` when none (expired counts as
none).

**`GET /api/v1/invitations/watch/{watch_key}/events` — invitation SSE stream**
(public, no headers so `EventSource` works)

- Opens with one `waiting` frame, then exactly one terminal frame —
  `accepted {match_id}` | `cancelled` | `replaced` | `expired` — and the
  server closes the stream. No `id:` field (nothing to resume).
- `404` = no open invitation for this key (already accepted/cancelled/
  replaced/expired). A waiting screen getting `404` should check
  `GET /matches/ongoing?student_id=…` — the match may already exist.
- `expired` is produced by the stream itself at `expires_at`; nothing is
  written, so only an open stream reports it.
- Max 200 simultaneous watchers per invitation, else `503` (fall back to
  polling the match list).

#### Matches — reads (all public)

**`GET /api/v1/matches/ongoing?student_id=&limit=&offset=`** — list ongoing
(`listOngoingMatches`) → bare array of `OngoingMatch`. Filter by student;
paged via `limit/offset`.

**`GET /api/v1/matches/ongoing/{match_id}`** (`getOngoingMatch`)
→ `200 OngoingMatch` or `400` (malformed id) / `404`.

**`GET /api/v1/matches/completed?student_id=&limit=&offset=`** and
**`GET /api/v1/matches/completed/{match_id}`** — same shape for finished

games → `CompletedMatch` (includes `result: white|black|draw`,
`termination`, `winner_id/loser_id` (null on draw), `ply`, `started_at`,
`ended_at`, plus `settlement_state: pending|delivered|dead|voided|null` —
`null` when the match earned no points, i.e. a draw under the current v2
policy). Lists are **newest-first** (`ended_at` then `match_id` for
completed, `started_at` then `match_id` for ongoing), so paging never
repeats or skips a row. Aborted matches never appear in the completed list
— they are deleted, not recorded — and a match leaves the ongoing list the
moment it ends.

`OngoingMatch` fields (all required):

| Field                               | Meaning                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `match_id`                          | ULID, shared with sport-tracking                                                                         |
| `white_id` / `black_id`             | Student IDs (random colours at accept time)                                                              |
| `moves`                             | UCI strings oldest-first, e.g. `["e2e4","e7e5","g1f3"]`; promotion `e7e8q`; castling as king move `e1g1` |
| `fen`                               | Current position in FEN                                                                                  |
| `turn`                              | `white` \| `black`                                                                                       |
| `ply`                               | `moves.length`; echo back on your next move for staleness guard                                          |
| `white_clock_ms` / `black_clock_ms` | Remaining ms **as of this response**                                                                     |
| `increment_ms`                      | 5000 (5 s added after each of your moves)                                                                |
| `turn_started_at` / `started_at`    | ISO-8601 UTC                                                                                             |

#### Matches — writes (player credentials; moves/resign/timeout also need `X-Game-Token`)

**`POST /api/v1/matches/ongoing/{match_id}/session` — get your game token**
(`issueGameSession`, player creds only) → `201 GameSession`
`{match_id, student_id, side, token, issued_at}`. Only the two players may
call (`403` otherwise); `409` in edge cases (e.g. match already over). The token
dies with the match, so a finished game has none — re-issuing after the end is
`409`/`404`. This is the **inviter's** path to a token after learning `match_id` from
their invitation stream's `accepted` event.

**`POST /api/v1/matches/ongoing/{match_id}/moves` — play a move**
(`playMove`, player creds + game token)

```json
{ "uci": "e2e4" }
{ "uci": "e7e8q", "ply": 58 }
```

- `uci` required, `^ [a-h][1-8][a-h][1-8][qrbn]?$`; optional `ply` = the
  board you moved on — if the match moved on since, `409` instead of applying
  to a stale board. **Always send `ply`** when you have it.
- Response is a `MatchOutcome` envelope: `{ match_id, status, ongoing, completed }`
  where exactly one of `ongoing` / `completed` is set — except `aborted`,
  where both are `null` (match deleted, no result/points). A move can end
  the match (checkmate, stalemate, repetition, fifty-move, insufficient
  material — draws are automatic, no claim needed) or abort it (ended
  before both sides moved → deleted, no result/points).
- Time is enforced on action: moving after your flag fell ends the match on
  time **without playing the move** (still `200` with `status: completed` —
  or `aborted` if both sides hadn't moved yet); either player may claim via
  `/timeout`. Clocks: 10 min/side + 5 s/move (increment added after the move's
  time is deducted).
- Errors: `400` (bad UCI / illegal move / malformed id), `401/403` (auth or
  wrong/replaced game token or non-player), `404`, `409` (not your turn,
  stale `ply`, already completed).

**`POST /api/v1/matches/ongoing/{match_id}/resign`** (`resignMatch`, no body)
→ winner is the opponent; `MatchOutcome` envelope. Allowed on either player's
turn. Aborts (deletes) if both sides haven't moved yet.

**`POST /api/v1/matches/ongoing/{match_id}/timeout` — claim a win on time**
(`claimTimeout`, no body) → ends the match when the side to move has run out
of time (win, or draw if the other side can't possibly mate); either player may
call it. `409` while time remains; `aborted` before both sides moved.

> Note: `Termination` includes `agreement`, but no endpoint offers, accepts,
> or claims draws — draws are automatic, so `agreement` is unreachable through
> this API. Do not build a draw-offer UI against it.

#### Matches — admin settlement ops (admin token only, never from the game client)

**`POST /api/v1/matches/completed/{match_id}/requeue`** (`requeueCompletedMatch`)
— sets a `dead` or `voided` match's `settlement_state` back to `pending` with a
fresh retry count; the delivery worker resends the points stored when the match
ended (never recomputed). Returns the match. `409` when the match earned no
points, or is already `pending`/`delivered`. Tip from the spec: a match that
went `dead` because sport-tracking already holds a _different_ settlement for
it must be voided first — requeueing alone would only die again.
Responses: `200,400,401,404,409,500`.

**`POST /api/v1/matches/completed/{match_id}/void`** (`voidCompletedMatch`)
— deletes every ledger row sport-tracking holds for the match, then sets
`settlement_state` to `voided` so both services agree it pays nothing (e.g. match
was cheated). Works on any settlement state; the match itself stays in results.
**Idempotent**: voiding a `voided` match is a no-op, and retrying after a `502`
is safe. To pay the match again, requeue it. `409` when it earned no points;
`502` when sport-tracking is unreachable/refuses; `503` when no sport-tracking
connection is configured. Responses: `200,400,401,404,409,500,502,503`.

#### Match SSE stream (public)

**`GET /api/v1/matches/ongoing/{match_id}/events`** (`streamMatchEvents`)

- Opens with one `snapshot {ongoing}`, then one `move {uci, ongoing}` per
  move (SSE `id:` = resulting `ply`), then terminal `game_over {completed}`
  or `aborted {match_id}` and the server closes the stream.
- `event:` name === JSON `data.type` (`snapshot|move|game_over|aborted`) —
  branch on either. Every event carries the **whole state** (full board/FEN,
  move list, clocks), so a client that misses a frame is corrected by the
  next; reconnect just re-snapshots. No replay buffer: `Last-Event-ID` is
  accepted and **ignored**. `: keep-alive` comment every 15 s.
- Reconnecting to an ended match replays its final event (`game_over` or
  `aborted`) and closes; reconnecting to one whose result was never recorded
  is `404`. Max 200 watchers per match (else `503` → fall back to `GET`
  polling). Writes never go through the stream — moves still use `POST …/moves`.
- A clock running out produces **no event** until someone claims it via
  `POST …/timeout` — a client watching a clock hit zero must act on that
  itself (count down locally between events; clocks are as of each event).
- Note the read asymmetry: `GET …/ongoing/{match_id}` returns `404` once the
  match has ended — look it up under `/completed` instead (aborted matches are
  gone entirely), while the _stream_ replays the final event.

Example frame:

```text
event: move
id: 3
data: {"type":"move","uci":"g1f3","ongoing":{"match_id":"01K5A7M3X2Q9RZ4T8B6N1C0D5E","ply":3,…}}

: keep-alive

event: game_over
data: {"type":"game_over","completed":{"match_id":"01K5A7M3X2Q9RZ4T8B6N1C0D5E","result":"white",…}}
```

### 1.5 Canonical invite-to-board flow (both pages then open the match stream)

1. Inviter: `POST /invitations` → show link containing `token`, open
   `GET /invitations/watch/{watch_key}/events`.
2. Friend opens link → `POST /invitations/accept {token}` (player creds) →
   `201 {ongoing, session}` → friend's page opens board **at once** (has game
   token) + opens `GET /matches/ongoing/{match_id}/events`.
3. Inviter's stream delivers `accepted {match_id}` and closes → inviter's page
   opens `match_id`, calls `POST /matches/ongoing/{match_id}/session` for its
   own game token, then opens the match stream.
4. Both play via `POST …/moves {uci, ply}` with `X-Game-Token`; both watch the
   match stream for opponent moves / `game_over` / `aborted`.

### 1.6 Points & settlement

Policy **v2** (current): win **+3**, loss **−2**, draw **0** — a draw earns
nothing, so its `settlement_state` is `null`. Matches that ended under policy
v1 (win 3, loss 1, draw 1 each) keep what they earned. `settlement_state` on a
`CompletedMatch` is therefore `pending` (queued/retrying) → `delivered`, or
`dead` (rejected — services disagree, human must resolve: requeue, voiding
first when sport-tracking holds a different settlement), or `voided` (an admin
removed the points), or `null` (no points earned). Points are never recomputed:
a requeue resends what the match earned when it ended. Delivery normally lands
within ms of the final move; a sport-tracking outage only delays it (outbox +
backoff retry).

This service keeps **no rating, Elo, or leaderboard**. Rankings live in
sport-tracking's `chess` board (`GET /api/v1/leaderboard?sport_tag=chess`),
derived from settled points.

### 1.7 TypeScript fetch sketches

```ts
const API = 'https://act.gormadatyan.xyz/chess';
const playerHeaders = (session: string, studentId: string) => ({
	Authorization: `Bearer ${session}`,
	'X-Student-Id': studentId,
	'Content-Type': 'application/json'
});

// Issue invitation (inviter)
const res = await fetch(`${API}/api/v1/invitations`, {
	method: 'POST',
	headers: playerHeaders(session, studentId)
});
const issued = await res.json(); // { token, watch_key, ... }
const link = `${location.origin}/chess/join?token=${issued.token}`;

// Watch invitation (EventSource needs no headers — key is the capability)
const es = new EventSource(`${API}/api/v1/invitations/watch/${issued.watch_key}/events`);
es.addEventListener('accepted', async (e) => {
	const { match_id } = JSON.parse((e as MessageEvent).data);
	const s = await fetch(`${API}/api/v1/matches/ongoing/${match_id}/session`, {
		method: 'POST',
		headers: playerHeaders(session, studentId)
	});
	const gameSession = await s.json(); // { token, side, ... } — store, show once
	watchMatch(match_id);
});

// Accept (friend, from link token)
const acc = await fetch(`${API}/api/v1/invitations/accept`, {
	method: 'POST',
	headers: playerHeaders(session, friendId),
	body: JSON.stringify({ token })
});
const { ongoing, session } = await acc.json(); // open board now

// Play (always send ply + game token)
await fetch(`${API}/api/v1/matches/ongoing/${match_id}/moves`, {
	method: 'POST',
	headers: { ...playerHeaders(session, studentId), 'X-Game-Token': gameToken },
	body: JSON.stringify({ uci: 'e2e4', ply: ongoing.ply })
});

// Watch match
function watchMatch(match_id: string) {
	const mes = new EventSource(`${API}/api/v1/matches/ongoing/${match_id}/events`);
	mes.addEventListener('snapshot', applyFullState);
	mes.addEventListener('move', applyFullState);
	mes.addEventListener('game_over', closeWithResult);
	mes.addEventListener('aborted', closeAsAborted);
}
```

### 1.8 Errors — full table

Every error is `{ "error": "<code>", "message": "diagnostics…" }`:

| HTTP | `error`                  | Typical cause                                                                                                                                                                                                      |
| ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400  | `bad_request`            | Malformed student/match ID, non-UCI or illegal move, wrong-typed query, non-JSON body                                                                                                                              |
| 401  | `unauthorized`           | Missing session token / missing-or-malformed `X-Student-Id`; missing or wrong admin token (docs, void, requeue); always `401` when no `ADMIN_TOKEN` is configured                                                  |
| 403  | `forbidden`              | Not a player in this match; missing/wrong/replaced `X-Game-Token`; student unknown to portal                                                                                                                       |
| 404  | `not_found`              | Unknown match; no open invitation; unknown/expired invitation token; unknown route                                                                                                                                 |
| 405  | `method_not_allowed`     | Known path, wrong method (`Allow` lists valid ones)                                                                                                                                                                |
| 409  | `conflict`               | Not your turn; stale `ply`; match already completed; accepting own invitation; timeout claimed with time remaining; voiding/requeueing a match that earned no points; requeueing one already `pending`/`delivered` |
| 413  | `payload_too_large`      | Body > 2 MB                                                                                                                                                                                                        |
| 415  | `unsupported_media_type` | JSON body without `Content-Type: application/json`                                                                                                                                                                 |
| 422  | `unprocessable_entity`   | Valid JSON failing schema (missing/unknown/mistyped field — bodies are strict)                                                                                                                                     |
| 500  | `internal_error`         | DB / I/O failure                                                                                                                                                                                                   |
| 502  | `bad_gateway`            | Student portal unreachable (invitations only; games never call portal) **or** sport-tracking unreachable/refusing on admin void                                                                                    |
| 503  | `service_unavailable`    | Stream refused — >200 watchers on that match/invitation                                                                                                                                                            |

---

## Part 2 — How the current frontend matches (and doesn't match) the API

### 2.1 Frontend architecture today (all local, zero backend calls)

| File                                                       | Role                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/App.tsx`                                              | Routing + rooms. `OnlineRoom` (2 tabs handshake) and `LocalRoom` (same-screen). Query params: `?game=XXXXXX`, `?you=Name`, `?local=1&white=&black=`, plus uncommitted test mode `?solo=1`/`?test=1` (play both sides on one screen, bypasses lobby). `makeGameId()` = 6-char base36, `tabName()` via `sessionStorage`. `RoomShell` = topbar + sidebar + board + modal. |
| `src/net/useSyncedGame.ts`                                 | **Replaces the entire backend today.** `BroadcastChannel('act-chess-'+gameId)` + `localStorage` seat claims (`act-chess-{gameId}-seats`, 120 s staleness) for White/Black assignment, `hello/bye/ready/move/sync-request/sync-state` messages, 1.5 s hello loop, 6 s peer pruning, `pressReady/doMove`. Same-browser-tabs only.                                        |
| `src/chess/engine.ts`                                      | **Replaces server authority today.** Full client rules: pseudo+legal move gen, castling, en passant, promotion, check/checkmate/stalemate, fifty-move (halfmove ≥ 100), insufficient material (K vs K, K+minor vs K), SAN (`moveToSan`). Note: no threefold repetition, no clocks.                                                                                     |
| `src/components/ChessBoard.tsx`                            | Board grid, selection/targets, promotion modal, last-move + check highlight, move list (SAN pairs with piece glyphs), move/capture fly animation (340 ms, honors `prefers-reduced-motion`), `locked` overlay, `myColor: 'w'                                                                                                                                            | 'b' | 'both' | null` gating (`canMoveNow`). Consumes `Move {fromR,fromC,toR,toC,promotion?,isCastle?,isEnPassant?}`— **not UCI**.`HistoryEntry`now also carries`piece` (the moved piece, for glyphs/animation). |
| `src/components/ProfileSidebar.tsx`                        | Opponent/You cards (name, faculty, group, photo/initials avatar, color, Ready ✓, turn ring).                                                                                                                                                                                                                                                                           |
| `src/data/students.ts`                                     | **Replaces the student portal today.** 3-entry static `DIRECTORY` + `resolveStudent()` with graceful fallback (`—` fields). No IDs in flow; names are free text.                                                                                                                                                                                                       |
| `src/main.tsx`, `index.css`, `App.css`, `design-system.md` | Bootstrap, styling, portal design tokens. No networking config; `vite.config.ts` is stock; no API base URL, no proxy, no env.                                                                                                                                                                                                                                          |

Verified: **no `fetch`, no `EventSource`, no `Authorization`/`X-Student-Id`/
`X-Game-Token` headers, no ULID/`watch_key`/FEN/UCI handling anywhere in
`src`. The `gameId` is a shareable room code, not a backend match.

### 2.2 Concept-by-concept mapping

| API concept                                                                                                                                                      | Frontend today                                                                                                                    | Match?                        | What integration requires                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match (`match_id` ULID, `OngoingMatch`)                                                                                                                          | `gameId` 6-char code + local `GameState`                                                                                          | ❌ different ID + local state | Use server `match_id` from accept/session flow as the room key; render from server `fen`/`moves`/`turn`, not local engine as source of truth. Keep `engine.ts` only for move highlighting / preview.                                                              |
| Invitation link (`token` + `watch_key`, 24 h, single-use, one-open-per-student)                                                                                  | Shareable URL `?game=XXXXXX` (reusable, never expires, unlimited rooms)                                                           | ❌ shape differs              | New waiting screen: `POST /invitations` → link `…/join?token=…`; inviter watches `…/watch/{watch_key}/events`; `GET /invitations/me` to resume; `DELETE` to cancel. Handle `replaced/cancelled/expired` + `404→check ongoing list`.                               |
| Accept → random colours + `StartedMatch{ongoing, session}`                                                                                                       | `localStorage` seat claim (first tab White, second Black; stale 120 s; spectators if full) + manual OK modal                      | ❌                            | Delete seat-claim path for online play: colours come from server (`GameSession.side` + `white_id/black_id`). Keep the OK modal only as UX, not as authority.                                                                                                      |
| Auth (portal session + `X-Student-Id`; game token per match)                                                                                                     | Free-text display names (`?you=`, `tabName()`); no IDs, no tokens                                                                 | ❌                            | Add login/identity (portal session + student ID `CS/EM/DA+7`), persist game token per match (memory/session, never localStorage long-term — it's shown once; re-issue replaces). Send the 2 (or 3) headers on every authed call.                                  |
| Player directory (portal; names/photos)                                                                                                                          | Static 3-person `DIRECTORY`                                                                                                       | ⚠️ placeholder                | Replace/augment `resolveStudent` with portal lookup; keep fallback avatar for unknown names.                                                                                                                                                                      |
| Moves (UCI `e2e4/e7e8q/e1g1`, server-validated, `ply` guard)                                                                                                     | `Move` objects over `BroadcastChannel`, client-applied, no validation handshake                                                   | ❌ wire format differs        | Add `Move ↔ UCI` codec (needs promotion piece + castling-as-king-move mapping; engine squares ↔ `a1–h8`). Always send `{uci, ply}`; on `409` stale-`ply`/not-your-turn, re-sync from `GET` match or last SSE snapshot.                                            |
| Board truth (server FEN + full `moves[]`)                                                                                                                        | Local `GameState{board,turn,castling,enPassant,halfmove,fullmove}` + `HistoryEntry{san,move,captured}`                            | ⚠️ convertible                | Apply SSE `snapshot/move` full states (FEN→board or replay UCI list through engine for display); derive SAN locally via `moveToSan` for the move list. Server is truth; local engine is view/assist.                                                              |
| Clocks (10 min + 5 s/move, `white_clock_ms/black_clock_ms`, `turn_started_at`, timeout claims)                                                                   | None — no timers at all                                                                                                           | ❌ missing UI + logic         | New clock display (count down from last server timestamps + `increment_ms`); client clock is estimate only. Add claim-timeout button (`POST …/timeout`, `409` = too early) and handle flag-fall-on-move endings. Note: no SSE event for expiry — must poll/claim. |
| Endings (server: checkmate/stalemate/repetition/fifty-move/insufficient + `resign`/`timeout`; `game_over/aborted` events; `CompletedMatch` + `settlement_state`) | Client `getGameResult` (checkmate/stalemate/fifty-move/insufficient only — **no repetition detection**) + no resign/timeout/abort | ⚠️ partial                    | Add Resign + Claim-timeout buttons; handle `game_over` (show `result/termination/winner_id`, points note v2: win +3 / loss −2 / draw 0) and `aborted` (room deleted, no result). Add repetition detection locally only if needed for preview — server decides.    |
| Live updates (SSE `snapshot/move/game_over/aborted`, `id: ply`, keep-alive 15 s, 200 watchers, `Last-Event-ID` ignored)                                          | `BroadcastChannel` messages + full-state `sync-state` adoption if sender ahead                                                    | ❌ transport differs          | Replace transport in `useSyncedGame` (or add `useServerGame`): `EventSource` for match stream + `POST` moves. Same "full-state wins" mental model already exists — easy port. Handle `503` → fallback to `GET` polling; reconnect → fresh snapshot.               |
| Lists (`GET ongoing/completed?student_id&limit&offset`, bare arrays)                                                                                             | None — no history, no match lookup                                                                                                | ❌                            | New "My games / History" screens; page until `< limit`. Useful also for the `invitation-404 → find started match` recovery path.                                                                                                                                  |
| Errors (`ErrorBody`, strict bodies, 400/401/403/404/409/413/415/422/500/502/503)                                                                                 | Silent `try/catch` ignores (illegal remote move → `sync-request`)                                                                 | ❌                            | Surface toasts/errors per code: `409` = refresh + "not your turn/stale"; `403` = re-issue game token or wrong identity; `404` = invitation consumed/expired; `503` = polling fallback; `502` = portal down (invites only).                                        |
| Health                                                                                                                                                           | None                                                                                                                              | ❌                            | Optional status dot via `GET /health`.                                                                                                                                                                                                                            |

### 2.3 Biggest gaps (ordered by integration impact)

1. **Transport**: `BroadcastChannel` (same-browser only) → REST + SSE
   (cross-device). The hook's message model ports cleanly, but `useSyncedGame`
   must be replaced/supplemented, not patched.
2. **Authority**: client engine → server FEN/UCI. `engine.ts` stays as a
   view helper (legal-target dots, SAN, check highlight), never as truth.
3. **Identity**: free-text names → portal `student_id` + session token +
   per-match game token. Affects every write path.
4. **Lobby**: `?game=` room code → invitation `token`/`watch_key` flow with
   expiry, single-use, replace/cancel semantics.
5. **Time**: no clocks → countdown + timeout-claim UX (only ending with no
   server event).
6. **Endings/history**: no resign, no repetition, no completed-match record,
   no points/settlement display.

### 2.4 Suggested integration shape (no code changed yet)

> Step 1 (done): read-only spectator slice — `src/net/api.ts` (public GETs,
> SSE watcher, UCI/FEN codecs), `src/components/WatchRoom.tsx` (`?watch=`),
> `src/vite-env.d.ts` for `VITE_CHESS_API`. No auth, no writes yet.

- `src/net/api.ts` — `API_BASE` (env `VITE_CHESS_API`, default
  `https://act.gormadatyan.xyz/chess`), typed `fetch` wrappers for all 17 player+
  admin operations (game client needs only the 15 non-admin ones), `ErrorBody` handling, `Move↔UCI` + FEN helpers.
- `src/net/useServerGame.ts` — `EventSource` match stream + `POST` moves
  (`{uci, ply}`), clock estimation, resign/timeout actions; same return shape
  as `useSyncedGame` so `ChessBoard`/`App` barely change.
- `src/pages/Invite.tsx / Join.tsx / History.tsx` — issue/wait (`watch_key`
  stream), accept-from-`token`, ongoing/completed lists.
- Keep `LocalRoom` (`?local=1`) fully offline as today; gate `OnlineRoom`
  behind player credentials.
- Never store the admin bearer token in the frontend; it is only for
  `api-docs`. Portal session + game tokens live in memory (or session scope),
  and game tokens are re-issuable on loss.

---

## Appendix — quick endpoint checklist

- [ ] `GET /health`
- [ ] `POST /api/v1/invitations` → `{token, watch_key}`
- [ ] `GET /api/v1/invitations/watch/{watch_key}/events` → `waiting` then
      `accepted|cancelled|replaced|expired`
- [ ] `POST /api/v1/invitations/accept {token}` → `{ongoing, session}`
- [ ] `GET / DELETE /api/v1/invitations/me`
- [ ] `GET /api/v1/matches/ongoing[?student_id&limit&offset]`
- [ ] `GET /api/v1/matches/ongoing/{match_id}`
- [ ] `GET /api/v1/matches/ongoing/{match_id}/events` → `snapshot, move*,
    game_over|aborted`
- [ ] `POST /api/v1/matches/ongoing/{match_id}/session` (inviter's game token)
- [ ] `POST /api/v1/matches/ongoing/{match_id}/moves {uci, ply?}`
- [ ] `POST /api/v1/matches/ongoing/{match_id}/resign`
- [ ] `POST /api/v1/matches/ongoing/{match_id}/timeout`
- [ ] `GET /api/v1/matches/completed[?student_id&limit&offset]` (newest-first)
- [ ] `GET /api/v1/matches/completed/{match_id}` (+ `settlement_state`)
- [ ] `POST /api/v1/matches/completed/{match_id}/requeue` (admin — resend points)
- [ ] `POST /api/v1/matches/completed/{match_id}/void` (admin — erase points)
