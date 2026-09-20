# Code review — ACT Chess frontend

Reviewed 2026-09-19 at commit `2cba796` (clean tree). Scope: everything under `src/`,
the config files, and the docs (`README.md`, `NOTES.md`, `API.md`).

`npm run build` and `npm run lint` both pass with no warnings. There are no tests.
None of the findings below were caught by the build or the linter.

Severity scale: **Critical** means anyone can abuse it, **High** means a real bug users
will hit, **Medium** means a bug in an edge case or a clear UX defect, and **Low** covers
cleanup and polish.

---

## Summary

| # | Severity | Area | Problem |
|---|----------|------|---------|
| 1 | Critical | Auth (backend + client) | Anyone can play, resign or claim a timeout in someone else's match |
| 2 | High | SSE / polling | The server closing the stream after game end starts reconnect and poll loops that never stop |
| 3 | High | Play / Watch | The final board disappears right after the game ends |
| 4 | High | Play | The board never flips for Black, and the sidebar always labels White as "You" |
| 5 | High | Polling fallback | `pollMatch` can't detect an aborted match and retries forever |
| 6 | Medium | Invite | The polling fallback and "Look up my match" can pick up the wrong match |
| 7 | Medium | Invite | Invitation polling never stops once the invitation is cancelled or expires |
| 8 | Medium | Invite | Typing credentials fires a request on every keystroke and disables the form mid-typing |
| 9 | Medium | Play | Editing the student ID one character at a time deletes the stored game token |
| 10 | Medium | Play | 409 handling depends on error codes and message text the server doesn't send |
| 11 | Medium | Network | No request timeouts, so a hung request locks the play controls |
| 12 | Medium | Play | A move made while another request is in flight is silently dropped |
| 13 | Medium | History | Offset paging over a newest-first list gives duplicates and React key collisions |
| 14 | Medium | Clocks | Clock estimates use the client's wall clock, so clock skew shows wrong times |
| 15 | Low | Engine | SAN, insufficient-material and repetition gaps |
| 16 | Low | UX / copy | Development-process text shown in the UI, wrong labels, inconsistent token handling |
| 17 | Low | Maintainability | Duplicated helpers, a storage key written in three places, dead code, stale lint suppressions |
| 18 | Low | Project hygiene | Template README, placeholder package name, no tests, no env docs, `NOTES.md` inconsistencies |

---

## 1. Critical: anyone can take over a player's seat

**Where:** backend auth model (documented in `API.md` §1.2); client code in
`src/net/identity.ts`, `src/net/api.ts` (`issueGameSession`).

- `API.md` states that portal session tokens are not verified: any non-blank token is
  accepted for any well-formed student ID.
- The per-match game token is meant to be the real protection. But
  `POST /matches/ongoing/{id}/session` issues a game token to anyone who presents one of
  the two players' student IDs.
- An attacker can get everything they need from public endpoints. `GET /matches/ongoing`
  (no auth) returns `match_id`, `white_id` and `black_id` for every live game.

**Attack:** list the ongoing matches, send `X-Student-Id: <white_id>` with
`Authorization: Bearer x`, call `/session` to get a game token, then `/resign`. Re-issuing
the token also revokes the real player's token, so the real player loses their seat.
Invitations can be forged the same way (`POST /invitations` as any student ID).

This is not safe to deploy while points settle to sport-tracking (+3/−2). Portal session
verification has to land on the server before release. No client-side fix can close this.

## 2. High: stream-close reconnect and poll loops after the game ends

**Where:** `src/net/api.ts` (`watchMatch`, `watchInvitation`, `pollMatch`);
`src/components/PlayRoom.tsx:272`, `WatchRoom.tsx:133`, `InviteLobby.tsx:133`.

The spec says: *"…then terminal `game_over` or `aborted` and the server closes the
stream."* When the server closes a stream, `EventSource` fires `error` and reconnects
automatically. None of the terminal handlers call `es.close()`. As a result:

1. `onError` runs, and the screen shows *"Live stream interrupted — polling…"* on a game
   that ended normally.
2. `startPolling()` starts `pollMatch`, which then runs every 3 s indefinitely. Each tick
   sends `GET ongoing/{id}` (404) followed by `GET completed/{id}`, so every open tab makes
   2 requests per 3 s for as long as it stays open.
3. `EventSource` keeps reconnecting too. The spec says that reconnecting to an ended match
   *replays its final event and closes*, so the tab loops through reconnect, `game_over`,
   close, error, reconnect indefinitely.

The effect in `PlayRoom`/`WatchRoom` only cleans up on unmount or when `matchId`/token
changes, so nothing stops these loops when the phase becomes `over`.

**Fix:** close the `EventSource` inside the `game_over`/`aborted` handlers (and in the
invitation terminal handlers). Stop `pollMatch` after it delivers a terminal result. Only
fall back to polling when `es.readyState === EventSource.CLOSED` and no terminal event
has arrived.

## 3. High: the final board disappears after the game ends

**Where:** `PlayRoom.tsx:211, 266, 355`, `WatchRoom.tsx:67, 127`

```ts
setPhase((prev) => ({ kind: "over", completed, view: prev.kind === "live" ? prev.view : null }));
```

This keeps the board only when the previous phase was `live`. A second terminal
notification therefore replaces the view with `null`. Second notifications are routine:

- After a resign or timeout, `handleOutcome` sets `over` with the view, and then the SSE
  `game_over` arrives, finds `prev.kind === "over"`, and sets `view: null`.
- The replay/poll loops from #2 deliver `game_over` over and over.

Result: the final position and move list vanish right after the game ends. `WatchRoom`
falls back to the board-less result modal.

**Fix:** `view: prev.kind === "live" || prev.kind === "over" ? prev.view : null`, or
ignore terminal events once the phase is already `over`.

## 4. High: Black plays upside-down and is labelled wrong

**Where:** `ChessBoard.tsx` (fixed `rows = [0..7]`), `PlayRoom.tsx:455, 467`

- `ChessBoard` always renders White at the bottom. It has no orientation prop, so the
  Black player has their own pieces at the top.
- `PlayRoom`'s sidebar always shows Black on top as *"Opponent · Black"* and White at the
  bottom as *"You · White"*. The Black player sees their opponent labelled "You".
- `WatchRoom.tsx:199` labels Black as *"Opponent"* on the spectator view, where neither
  player is the viewer.

**Fix:** add an `orientation`/`flipped` prop to `ChessBoard` that reverses rows, columns
and coordinates, and choose the sidebar's top/bottom and "You/Opponent" tags from `myColor`.

## 5. High: the polling fallback can't detect an aborted match

**Where:** `api.ts` `pollMatch`

An aborted match is deleted, so `GET ongoing/{id}` returns 404 and `GET completed/{id}`
also returns 404. `pollMatch` treats this as `onError` and never calls `onAborted`. In
`PlayRoom` the user sees *"Server unreachable — retrying every few seconds…"* forever. In
`WatchRoom` the last live board stays on screen.

**Fix:** if the match was seen ongoing before and both GETs now return 404, report
`onAborted(matchId)` and stop polling.

## 6. Medium: the invitation fallback can pick up the wrong match

**Where:** `api.ts` `pollInvitationForMatch` (`limit: 1`), `InviteLobby.tsx:235` (`list[0]`)

Both take the student's first ongoing match. If the inviter already has another game in
progress, the lobby jumps straight to that game as soon as polling starts, before the
invitation is accepted. It then calls `issueGameSession` for that match, which revokes the
token the player is using in the other tab.

**Fix:** only accept a match whose `started_at` is after the invitation's `created_at`
(and where the inviter is a player), or compare against a snapshot of the match list
taken when the invitation was issued.

## 7. Medium: invitation polling never stops

**Where:** `api.ts:649` comment vs `InviteLobby.tsx`

The comment says *"explicit cancel/expire still arrives via `GET /invitations/me` checks
in the caller"*, but the caller makes no such checks. Once the stream has failed, a
cancelled or expired invitation keeps the lobby polling every 4 s indefinitely and
showing "Waiting for your friend…". A 404 on the invitation stream also makes
`EventSource` retry that URL indefinitely, because nothing closes it.

## 8. Medium: the invite lobby resumes on every keystroke

**Where:** `InviteLobby.tsx:68–106`

The resume effect depends on `[identity.studentId, identity.sessionToken]`. Once the ID
is valid, every character typed into the token field:

- sends `GET /invitations/me`, and
- sets `status = "resuming"`, which disables `IdentityFields` (`waiting` includes
  `resuming`). The inputs lock mid-typing until the response arrives.

A slow early response can also overwrite the result of a later one. There is no ordering
guard beyond `cancelled`, and a response that has already resolved can still land.

**Fix:** resume on an explicit "Continue" button or on blur, or debounce the request, and
don't disable the inputs while resuming.

## 9. Medium: editing the student ID deletes the game token

**Where:** `PlayRoom.tsx:135–146`

The effect removes the stored game token as soon as `identity.studentId` differs from the
token's owner. Fixing one character (for example backspacing a digit) permanently deletes
the token from `sessionStorage` and forces a re-issue. Re-issuing revokes the token held by
any other tab.

**Fix:** compare only when the ID is valid (`isValidStudentId`), or hide the stored token
without deleting it.

## 10. Medium: 409 messages depend on codes and text the server doesn't send

**Where:** `PlayRoom.tsx:79–97` (`friendlyWriteError`)

`API.md` says the `error` field for every 409 is `conflict`, so `e.code === "stale_ply"`
never matches. The branches then fall back to regexes over `message`, which the spec calls
"diagnostics…" and does not specify. `/time/i` also matches any message containing
"time" (for example "timeout" or "time control"). The user-facing copy depends on
unspecified server wording.

**Fix:** branch on which call failed (move, resign, timeout) plus the status code, not on
message text.

## 11. Medium: no request timeouts

**Where:** every `fetch` in `api.ts`

No `AbortController` or timeout is used. If a `POST …/moves` hangs, `sending` stays
`true`, which disables Resign, Claim timeout and Re-issue and makes the board ignore
input (see #12). Unmounting doesn't abort in-flight requests either.

## 12. Medium: moves made during a pending request are silently dropped

**Where:** `PlayRoom.tsx:553` (`locked={phase.kind !== "live"}`) and `onMove` guard

While `sending` is true the board isn't locked, so the player can select a piece and a
target. `onMove` then returns early (`if (… sending) return`), `ChessBoard` clears the
selection, and the move disappears without any feedback. The `lockLabel="Sending…"` text
is never shown because `locked` is false.

**Fix:** `locked={phase.kind !== "live" || sending}`.

## 13. Medium: history paging shows duplicate rows

**Where:** `HistoryRoom.tsx` `onLoadMore`

The lists are newest-first and paged by `offset`. A match that starts or finishes between
page loads shifts every offset by one, so the next page repeats a row. Rows are keyed by
`match_id`, so React warns about duplicate keys and may render the wrong row. Ongoing
matches that end between pages can also be skipped.

**Fix:** de-duplicate by `match_id` when appending (a cursor or `before=` parameter would
need server support).

## 14. Medium: clock estimates depend on the client's wall clock

**Where:** `PlayRoom.tsx:303`, `WatchRoom.tsx:159`

`elapsed = now - Date.parse(turn_started_at)` compares a server timestamp with the local
clock. A client whose clock is 20 s fast shows 20 s less on the side to move and triggers
the "clock hit zero" nudge early. A slow clock shows more time than the player has.

**Fix:** measure elapsed time from when each snapshot was *received* (`performance.now()`
at receipt), or estimate the offset from the response `Date` header.

## 15. Low: engine gaps (`src/chess/engine.ts`)

The server is authoritative, so these only affect local play and the display.

- **Castling SAN has no check or mate suffix:** `moveToSan` returns `'O-O'`/`'O-O-O'`
  before the `+`/`#` check runs.
- **Insufficient material is incomplete:** only K vs K and K+minor vs K are detected. K+B
  vs K+B with same-coloured bishops is missed. The server declares that draw
  automatically, so local play can continue past a dead position.
- **No threefold or fivefold repetition:** local games never end by repetition. This is
  documented, but `?local=1` is fully offline, so a local game can loop forever.
- `moveToSan` computes `allLegalMoves(next, enemy)` on every move, even when the move
  doesn't give check.
- `buildView` stops replaying at the first move it can't resolve, which leaves the
  history truncated and `lastMove` wrong with no warning.
- `LocalRoom` has no "new game" or rematch control after the game ends.

## 16. Low: UX and copy

- Development-process labels appear in the product UI, for example *"Backend match ·
  steps 3–4"* (`PlayRoom`), *"Backend lobby · step 2"* (`InviteLobby`/`JoinRoom`),
  *"Backend history · optional"* and *"Start now (test mode)"*.
- The game token is handled inconsistently. `JoinRoom` hides it behind "Reveal" and says
  *"never logged"*. `InviteLobby` prints it in plain text and says *"shown once, step 3
  will use it"*. The token doesn't need to be shown at all, because it's already saved
  for the play view.
- `JoinRoom` says *"shown once — copy it now, it dies with the match"*, but `PlayRoom`
  can re-issue it at any time.
- Result labels show raw student IDs (`CS0103125 wins · checkmate`) rather than names.
- `HistoryRoom` shows a "Play" link on every ongoing row, including other students'
  matches, and asks for a session token that the public history endpoints don't need.
- The "Replay" link in history opens `?watch=`. For a completed match that page shows only
  the result card with no moves, because `CompletedMatch` has no move list, so there is
  nothing to replay.
- In `HistoryRoom`, a deep link `?history=X` loads X's matches while the ID field can
  still show a different saved ID (`HistoryRoom.tsx:47–55`).
- `src/data/students.ts` is a hard-coded sample directory with real-looking names bound to
  real-format IDs. The "Narek Sargsyan" entry has a `CS` ID with faculty "Business" and
  group `BS-21A`. A real student with one of these IDs would be shown as someone else.
- The `LocalRoom` welcome sentence is grammatically broken, for example *"Welcome to ACT
  Chess, White you are now playing with Black"*.
- `IdentityFields` uses inline styles because `App.css` has no input styles. The
  hard-coded colours and font bypass `design-system.md`.

## 17. Low: maintainability

- **Duplicated helpers:** `resultLabel` appears 3× (Play, Watch, History), `formatClock`
  2×, `playUrl` 3×. The `watchMatch` and `pollMatch` handler objects are copied
  near-verbatim in `PlayRoom` and `WatchRoom`. The "load ongoing, then 404 → load
  completed" logic appears 3×.
- The `act-chess-game-${matchId}` storage format is written by hand in `InviteLobby.tsx:156`
  and `JoinRoom.tsx:65`, and parsed in `PlayRoom.tsx:33`. It should be one module
  (`net/gameSession.ts`).
- In `api.ts`, `apiGet` duplicates `throwForStatus`'s error parsing, and `apiPost` and
  `apiPostGame` are the same function except for the headers.
- **Dead code:**
  - `setStatus((s) => (s === "idle" ? s : s))` (`InviteLobby.tsx:70`) is a no-op.
  - The `"issuing"` status is never set.
  - `EnPassantTarget`/`CastlingRights` exports are unused outside the engine.
  - The `FEN_PIECE` map is an identity map.
- There are 11 `eslint-disable … react-hooks/exhaustive-deps` comments, but the project
  uses oxlint, and `.oxlintrc.json` doesn't enable that rule. The suppressions do nothing
  and hide real missing-dependency issues. For example, the invitation effect captures
  `identity` at first render.
- `GameSession.side` and `StoredSession.side` are `string` rather than `Side`, and
  `CompletedMatch.termination` and `settlement_state` are untyped strings, although the
  spec defines enums for them.
- `VITE_CHESS_API` is read with an `as string | undefined` cast instead of an
  `ImportMetaEnv` declaration in `vite-env.d.ts`.

## 18. Low: project hygiene

- `README.md` is still the Vite template. It doesn't document routes, env vars or how to
  run the app against the backend.
- `package.json` `name` is `"vite-project"` with version `0.0.0`.
- There are no tests. The engine (move generation, SAN, FEN parsing, UCI conversion) is
  pure and easy to unit-test.
- There's no `.env.example` documenting `VITE_CHESS_API`.
- `NOTES.md`:
  - Sections are numbered out of order (§10 before §9).
  - §9 lists item 2 twice, once checked and once unchecked.
  - It records a partial admin-token fingerprint (`ast_…31C`). That's harmless on its own,
    but it doesn't belong in a committed file.
- The one real open item is still unverified: no live end-to-end move round-trip has ever
  been exercised (`NOTES.md` §9.1). Several findings above (#2, #3, #5) would show up on
  the first real game.

---

## Suggested order of work

1. Get server-side session verification in place (#1) before real points flow.
2. Fix the stream lifecycle and the lost final board (#2, #3, #5). These are small,
   related changes in `api.ts` plus the three rooms.
3. Board orientation and labels for Black (#4).
4. Invite-lobby correctness (#6, #7, #8) and play-room robustness (#9–#12).
5. Deduplicate helpers (#17) and add engine unit tests (#18). This makes the fixes above
   easier to keep correct.
