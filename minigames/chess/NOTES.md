# Chess integration — agent notes

Running log of what's been done, in order. For my own reference across sessions.

## 1. API guide (`minigames/chess/API.md`, created)

- Fetched `openapi.json` from `https://act.gormadatyan.xyz/chess/api-docs/openapi.json`
  (admin bearer `ast_…31C` — secret, kept out of committed files).
- Wrote a two-part guide: full backend usage manual (auth matrix, all endpoints,
  SSE semantics, points/settlement, error table, fetch sketches) + mapping of every
  API concept onto the then-current frontend (BroadcastChannel sync, client engine,
  static student directory, `?game=` room codes).
- Key finding: frontend used **zero** backend — 100% local.

## 2. Spec re-read + plan verification (API.md fixed, 8 issues)

- Re-fetched spec: OpenAPI 3.1.0, v0.1.0, **16 paths / 17 operations**, 19 schemas,
  5 security schemes. Verified each plan claim; fixed:
  1. Added missing admin endpoints `POST …/completed/{id}/requeue` + `…/void`
     (auth via Bearer **or** `X-Admin-Token`).
  2. Points policy corrected to **v2: win +3, loss −2, draw 0** (v1 is legacy only).
  3. `SettlementState` += `voided` + `null` (point-less draws).
  4. Noted no-rating-here; leaderboard is sport-tracking's `?sport_tag=chess`.
  5. Error table: 401/409/502 rows extended for admin cases.
  6. Nuances: flag-fall/abort-before-both-moved, token dies with match,
     GET-ongoing-404-once-ended vs stream-replays-final, newest-first lists,
     `agreement` termination unreachable (no draw-offer endpoint — don't build one).
  7. Part 2 drift: uncommitted UI changes (`?solo=1` test mode, move animations,
     `HistoryEntry.piece`).
- Verified via grep: no `fetch`/`EventSource`/auth in `src`; no repetition/clock/
  resign/UCI/FEN logic. Cleaned up temp `openapi-tmp.json` from the repo.

## 3. Integration step 1 — read-only spectator slice (implemented)

- `src/net/api.ts` (new): `API_BASE` (`VITE_CHESS_API` or prod default), typed public
  GETs (`health`, ongoing list/get, completed get), `ApiError`, `uciToMove()`
  (match against legal moves), `parseFen()`, `buildView()` (FEN board + replayed
  SAN history), `watchMatch()` (EventSource wrapper).
- `src/components/WatchRoom.tsx` (new): `?watch=<match_id>` — loading/live/over/
  aborted/error phases, locked spectator board, ticking clock estimates, completed
  fallback on GET 404 (spec: reads 404 once ended).
- `src/App.tsx`: `watch` route (checked first; skips `?game=` persistence).
- `src/vite-env.d.ts` (new): vite client types.
- Validation: `npm run build` ✅, `npm run lint` ✅ (fixed one react-purity warning
  by moving `Date.now()` into tick state). Live probe: `/health` ok, but
  ongoing/completed lists are **empty** — no live match to demo yet.
- Existing local/online play untouched (additive route only).

## 4. Integration step 2 — invitation lobby (implemented)

- `src/net/api.ts` (extended): player-credential slice — `PlayerIdentity`,
  authed `apiPost` (no `Content-Type` on bodyless POSTs — strict bodies, avoid 415) + `apiGetAuthed`, `throwForStatus`, types `IssuedInvitation` /
  `InvitationInfo` / `GameSession` / `StartedMatch`, `issueInvitation()`,
  `acceptInvitation()`, `getMyInvitation()`, `cancelMyInvitation()` (204),
  `issueGameSession()` (inviter's token path), `watchInvitation()`
  (EventSource over public `watch_key`: `waiting` then exactly one of
  `accepted {match_id}` | `cancelled` | `replaced` | `expired`).
- `src/net/identity.ts` (new): dev identity — `{studentId, sessionToken}` in
  `sessionStorage`, `STUDENT_RE ^(CS|EM|DA)\d{7}$`, `identityError()`.
  Decision per plan: portal session tokens are unverified (any non-blank
  token works) — fine for dev; the per-match game token is the real guard.
- `src/components/IdentityFields.tsx` (new): shared student-ID + session-token
  form (self-styled inline — no input styles in `App.css` yet).
- `src/components/InviteLobby.tsx` (new): `?invite` — create link
  (`POST /invitations` → `?join=<token>` + copy button), `watch_key` stream
  with waiting/accepted/cancelled/replaced/expired phases, resume-after-reload
  via `GET /invitations/me` (token shown only at issue — re-issue to re-share),
  cancel (`DELETE /me`), `404-on-stream → check ongoing?student_id` recovery,
  and background `issueGameSession()` on accept so the step-3 handoff is ready.
  Accepted → link to `?watch=<match_id>` (board play is steps 3–4).
- `src/components/JoinRoom.tsx` (new): `?join=<token>` — accept once
  (`POST /invitations/accept` → `{ongoing, session}`), shows match + own side
  - game token behind reveal-once UI (never logged/stored long-term), friendly
    404 (used/expired) / 409 (own invitation) errors, link to `?watch=`.
- `src/App.tsx`: `invite` / `join` routes (checked before `?game=`
  persistence, which now also skips them); existing local/online/watch play
  untouched (additive routes only).
- Validation: `npm run build` ✅, `npm run lint` ✅ (0 warnings). Live probe:
  `/health` ok; full lobby lifecycle verified — `POST /invitations` → 201
  `{token, watch_key, inviter_id, created_at, expires_at}`, `GET /me` → 200
  without `token`, `DELETE /me` → 204, `GET /me` after → 404. Probe
  invitation cancelled — no stray server state.

## 5. Integration steps 3–4 — server-authoritative play (implemented)

- `src/net/api.ts` (extended): `MatchOutcome` envelope
  (`{match_id, status, ongoing, completed}` — both null on `aborted`),
  `apiPostGame()` (player creds + `X-Game-Token`; no `Content-Type` on
  bodyless POSTs), `playMove()` (`{uci, ply}` — always sends `ply` for the
  staleness guard), `resignMatch()`, `claimTimeout()`, `moveToUci()`
  (engine Move → server UCI, castling as king move).
- `src/components/PlayRoom.tsx` (new): `?play=<match_id>` — identity gate
  (`IdentityFields` + `sessionStorage` identity), token gate
  (`POST …/session`, re-issue supported; token stashed session-scoped per
  match as `act-chess-game-<id> {token, side, studentId}`, dropped when the
  identity switches students), then GET-ongoing + `watchMatch()` SSE.
  Board renders only what the server returns (write response or next SSE
  event) — never applies moves locally. 409/404 → resync via GET-ongoing
  (404 → GET-completed for the final result); resign is two-click confirm;
  timeout claim surfaces the 409-while-time-remains message; ticking clock
  estimates; `game_over`/`aborted` terminal phases with result + settlement.
- `src/App.tsx`: `play` route (checked after `join`, before `?game=`
  persistence which now also skips it).
- `InviteLobby.tsx` / `JoinRoom.tsx`: accepted → stash the game token
  (inviter via background `issueGameSession`, accepter from the accept
  response) and link to `?play=<match_id>` (spectate kept as secondary).
- Validation: `npm run build` ✅, `npm run lint` ✅ (0 warnings).
  No live move round-trip probed (no two test students / live match at
  validation time) — verify with invite → accept → both `?play=` pages.
- Existing local (`LocalRoom`) + same-browser (`OnlineRoom`
  BroadcastChannel) + spectator (`WatchRoom`) play untouched.

## 6. Integration step 5 — retire the BroadcastChannel path (implemented)

- `src/net/history.ts` (new): `HistoryEntry` moved out of the deleted
  `useSyncedGame.ts` so `ChessBoard`, `api.ts` (`buildView`), and `LocalRoom`
  share one display type with no sync dependency.
- `src/net/useSyncedGame.ts` (deleted): BroadcastChannel + localStorage seat
  claims (`act-chess-{gameId}-seats`, hello/bye/ready/move/sync-state) gone.
  No `BroadcastChannel` / `useSyncedGame` / `OnlineRoom` references remain.
- `src/App.tsx`: `OnlineRoom` (+ `tabName`, `?you=` / `?solo=` / `?test=` test
  mode, `?game=` URL persistence) removed. `RetiredOnlineRoom` (new) handles
  legacy `?game=` links + bare root: explains the retirement and links to
  `?invite` (backend match flow) and `?local=1` (offline). `LocalRoom`
  (`?local=1`, same-screen dual-OK) untouched and still fully offline;
  `?watch=` / `?invite` / `?join=` / `?play=` routes unchanged.
- Validation: `npm run build` ✅, `npm run lint` ✅ (0 warnings).
- Existing backend play untouched (additive retirement notice only).

## Next (optional only)

- Draw-offer UI — do NOT build (no endpoint; `agreement`
  termination unreachable). Optional: admin requeue/void UI (admin token,
  never from the game client).

## 7. Integration step 5 (optional) — history screens + health dot (implemented)

- `src/net/api.ts` (extended): `MatchListOptions` (`limit`/`offset` per spec),
  `listOngoingMatches(studentId?, opts?)` (query built via `URLSearchParams`,
  backward-compatible with the old string-only call), new
  `listCompletedMatches(studentId?, opts?)` (newest-first, aborted matches
  absent by server design).
- `src/components/HealthDot.tsx` (new): `GET /health` probe on mount + every
  30 s, `server up` / `server down` / `checking…` badge (reuses `.badge`).
- `src/components/HistoryRoom.tsx` (new): `?history[=<student_id>]` —
  `IdentityFields` + manual lookup (auto-loads on deep-link), parallel
  ongoing (limit 20) + completed (limit 20) fetch, ongoing rows link to
  `?play=` / `?watch=`, completed rows show result + `settlement_state` and
  link to `?watch=` replay. Notes the newest-first + aborted-matches-deleted
  semantics.
- `src/App.tsx`: `history` route (before the retired catch-all), `HealthDot`
  in the retired-notice topbar, history deep-link added to the flow hint.
- `src/components/InviteLobby.tsx`: `HealthDot` in the topbar, history link
  added to the tip.
- Validation: `npm run build` ✅, `npm run lint` ✅ (0 warnings). Live probe:
  `/health` → `{"status":"ok"}`, `GET completed?limit=1` → `[]` (endpoint
  works; no finished matches on the server right now).
- Remaining optional: admin requeue/void UI only (never from the game
  client). Draw-offer UI stays out of scope (no endpoint).

## 8. Verification — backend integration complete (verified 2026-09-18)

- No next step to implement. Checked every Appendix item in `API.md`
  against `src/net/api.ts` + routes in `src/App.tsx`:
  - `GET /health` → `getHealth()` (`HealthDot`, 30 s probe) ✅
  - `POST /invitations` → `issueInvitation()` (`InviteLobby`) ✅
  - `GET /invitations/watch/{key}/events` → `watchInvitation()`
    (`waiting` then exactly one of `accepted|cancelled|replaced|expired`) ✅
  - `POST /invitations/accept` → `acceptInvitation()` (`JoinRoom`) ✅
  - `GET/DELETE /invitations/me` → `getMyInvitation()` /
    `cancelMyInvitation()` (resume-after-reload + cancel) ✅
  - `GET ongoing[?student_id&limit&offset]` → `listOngoingMatches()` ✅
  - `GET ongoing/{id}` → `getOngoingMatch()` (`PlayRoom`/`WatchRoom`) ✅
  - `GET ongoing/{id}/events` → `watchMatch()`
    (`snapshot/move*/game_over/aborted`) ✅
  - `POST ongoing/{id}/session` → `issueGameSession()` (inviter
    background handoff + `PlayRoom` token gate, re-issue supported) ✅
  - `POST ongoing/{id}/moves {uci, ply}` → `playMove()` (always sends
    `ply` staleness guard; board renders server state only) ✅
  - `POST ongoing/{id}/resign` → `resignMatch()` (two-click confirm) ✅
  - `POST ongoing/{id}/timeout` → `claimTimeout()` (409-while-time-remains
    surfaced) ✅
  - `GET completed[?student_id&limit&offset]` → `listCompletedMatches()`
    (newest-first) ✅
  - `GET completed/{id}` → `getCompletedMatch()` (404-once-ended
    fallback + `settlement_state` display) ✅
  - Admin `POST completed/{id}/requeue` + `…/void` → intentionally absent
    (admin token, never from the game client — per plan) ✅
  - Draw-offer UI → intentionally absent (`agreement` unreachable, no
    endpoint — per plan) ✅
- Retirement confirmed: no `BroadcastChannel`/`useSyncedGame`/`OnlineRoom`
  logic remains (only the word in the retired-notice copy + a code comment).
  Routes live: `?invite` / `?join=` / `?play=` / `?watch=` / `?history` +
  offline `?local=1`; legacy `?game=`/bare root → retired notice.
- Validation: `npm run build` ✅, `npm run lint` ✅ (0 warnings, 0 errors).
  No code changed — verification only.

## 10. Spec-polish items (§9.2) — implemented 2026-09-18

- `src/net/api.ts` (extended): `pollMatch()` (GET-ongoing poll, 404 →
  GET-completed, same handler shape as `watchMatch`) + `pollInvitationForMatch()`
  (polls `GET ongoing?student_id&limit=1` until a match appears) — the spec's
  `503` >200-watchers fallback. `EventSource` never surfaces HTTP status, so
  every stream `onError` degrades to polling instead of asking for a reload.
- `src/components/HistoryRoom.tsx`: spec paging — `PAGE_SIZE = 20`,
  `limit` + `offset` per list, "Load more" appends until a short page
  (`hasMore*` flags, `…+` count suffix while more may exist).
- `src/components/WatchRoom.tsx` / `PlayRoom.tsx`: stream `onError` →
  `pollMatch()` fallback + "polling every few seconds" hint (replaces the
  old "reload to reconnect" copy).
- `src/components/InviteLobby.tsx`: invitation-stream `onError` →
  `pollInvitationForMatch()` fallback + waiting-view hint; `polling` reset on
  re-issue.
- `src/components/PlayRoom.tsx`: flag-fall nudge — server sends no event on
  expiry, so when the local clock estimate hits zero a hint names the flagged
  side and the "Claim timeout" button promotes to primary (too-early claim
  is just a 409).
- Validation: `npm run build` ✅, `npm run lint` ✅ (0 warnings). Live probe:
  `/health` → `{"status":"ok"}`, `GET completed?limit=1` → `[]`,
  `GET ongoing?limit=1` → `[]` (server up; no matches to demo).

## 9. Remaining work to fully integrate backend (open, 2026-09-18)

- [x] 2. Small spec-polish items — done, see §10 (history "load more"
      paging, `503` → GET-polling fallback in match + invitation streams,
      flag-fall claim nudge).
- [ ] 1. Live end-to-end proof (the one real gap — §5 never probed a move
      round-trip; still open 2026-09-18 — server up but both lists empty, needs
      two real student IDs in two browsers). With two real student IDs: `?invite` → `?join=<token>` →
      both open `?play=<match_id>`; play moves (incl. `ply` staleness / 409
      resync), checkmate/stalemate auto-draw, resign (two-click), timeout claim
      (409-while-time-remains), abort-before-both-moved (deleted, in neither
      list); then `?watch=<match_id>` replay + `?history=<student_id>` showing
      `settlement_state` (`pending`/`delivered`/`dead`/`voided`/`null`).
- [ ] 2. ~~Small spec-polish items~~ — done (§10).
- [ ] 3. Intentionally never build in this client (documented, do not
      implement). Admin requeue/void (`POST completed/{id}/requeue`|`void` —
      admin token, separate tool only); draw-offer UI (`agreement` unreachable,
      no endpoint); leaderboard/rating (lives in sport-tracking
      `?sport_tag=chess`, separate integration if rankings are wanted).
