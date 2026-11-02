# Site login by login + password — design and decomposition (2026-11-02)

**Author:** Architect (insight-bot stream) · **Input:** `architecture/password-login-2026-11-02.md`
(user rulings 2026-11-02) · **Amends:** `member-access-design-2026-10-31.md` M1–M3 (Telegram widget
login, withdrawn) · **Output:** tasks IB-078, IB-079; IB-077 amended; IB-072's code removed by IB-078.

## 1. The shape

```
/invite (admin, bot) ─▶ /start <code> (bot) ─▶ users row (tg_user_id, chat_id)
                                   └─▶ bot replies with a one-time CREDENTIALS link
                                         https://<domain>/set-password?t=…
/password (bot, any member, any time) ──────▶ the same kind of link

/set-password?t=…  no credentials yet → choose login + password
                   credentials exist  → new password (login shown, not editable)
                   → all sessions of the account end → redirect to /login (no auto-login)

/login             login + password → ib_session (unchanged cookie, unchanged web_sessions)
header             "Log out" · "Log out everywhere" · /account: change password
/admin/logins      login journal (admin only)
```

The bot stays the identity anchor (`users.tg_user_id`) and the only issuer of credentials links. It
is no longer a way into the site.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| P1 | **One kind of bot link: a *credentials* link, not a login link.** It sets up or resets the password and then sends the person to `/login`. It never opens a session. | Rule 1 says the `/web` link is no longer a way in. A link that logs you in after you set a password would still be a login link with one extra step. Typing the new password once also proves it works before the person relies on it. |
| P2 | **Setup and reset are the same link and the same page.** The page asks for a login only if the account has none. `/start` after a redeemed invite sends it automatically. `/password` sends it on demand. `/web` stays only as a hint ("the site uses a login and password; `/password` to set or reset it"). | Existing members, the admin first, need no special path. Each uses `/password` once after deploy. There is one flow to test, not three. |
| P3 | **Link tokens reuse `web_login_tokens`** (sha256-only, 10 min, single use; codes 401 `TOKEN_INVALID`, 410 `TOKEN_USED`/`TOKEN_EXPIRED`). Issuing a new link deletes that user's unused ones. The migration deletes every unused row, so a `/web` login token minted before deploy cannot be spent as a credentials token. | The table already has exactly these semantics and specs. Only its meaning changes, and that is stated in a new migration's `comment on table`. Migration 006 is never edited (its MD5 is checked). |
| P4 | **Credentials live in their own table** `web_credentials(user_id PK → users ON DELETE CASCADE, login text UNIQUE, password_hash text, password_changed_at)`. `login` is stored lower-cased, so uniqueness is case-insensitive by construction. Allowed: ASCII `[a-z0-9._-]`, 3–32 characters, starting with a letter or digit. | The bot's `users` model and settings code stay untouched. ASCII-only removes look-alike logins (Cyrillic «а» vs Latin «a») for free. Disabled or plan state stays on `users`, so `resolveSession` remains the single access predicate (member-access-design §4). |
| P5 | **Hash: scrypt N=2^15, r=8, p=1, 16-byte salt, self-describing string `scrypt$N$r$p$salt$hash`**, verified with `timingSafeEqual`. The pattern is copied from `apps/signal-server/src/auth/password.ts`, not imported. Not argon2id: it needs a native module built for linux/arm64 inside the image, while scrypt is in Node's `crypto`. Not bcrypt: it silently truncates at 72 bytes. | Memory-hard, no dependency, and the project has already reviewed this scrypt setup. The parameters stored in each hash let cost go up later. **Memory guard for the 1 GB box:** one scrypt costs 32 MiB, so at most 2 run at once (a semaphore). Further requests wait, never more than ~64 MiB. |
| P6 | **Password rule: 10–128 characters, not equal to the login, nothing else.** No required character classes. | Length is the strength that matters; the upper bound stops a 1 MB "password" from becoming CPU work. Composition rules push people to `Password1!`. |
| P7 | **Brute force:** an in-memory throttle copied from signal-server `login-throttle.ts`, with reservation before verify (BUG-005). Two keys: **per login, 10 failures / 15 min**, and **per IP, 30 failures / 15 min**. Either one → 429 `TOO_MANY_ATTEMPTS`. One generic 401 `INVALID_CREDENTIALS` for an unknown login, a wrong password and a disabled account. An unknown login still runs one scrypt against a fixed dummy hash, so timing does not reveal which logins exist. | Single process, single box, closed contour. The per-login key lets a stranger lock someone out for 15 min. That is accepted, as in the backtest app, and the journal shows it. |
| P8 | **Client IP = `CF-Connecting-IP` only when `TRUST_CF_CONNECTING_IP=true`** (new env, default false; true on the box, where the only way in is the tunnel). Otherwise the socket address. | Anyone can spoof the header when the app is reached directly. On the box it is the only real IP the app sees, because the socket peer is cloudflared. |
| P9 | **"Log out everywhere"** = `POST /api/web/auth/logout-all` → `revokeUser(user.id)` + cleared cookie. **Change password** (`/account`: current + new) ends every *other* session and keeps this one. **Reset** through the link ends *all* sessions. | Brief §1.4 and §2. The functions already exist (`deleteSessionsForUser`); change password needs a variant that keeps the current session id. |
| P10 | **Login journal** `web_login_events(id, at, user_id NULL, login_attempted, outcome, ip, user_agent)`. Outcomes: `success`, `bad_credentials`, `throttled`, `password_set`, `password_reset`, `password_changed`, `logout_all`. Strings are truncated (login 64, UA 256). Kept 90 days (swept with `sweepExpired`). Read via `GET /api/web/admin/login-events?limit=` (`@AdminOnly`) and an `/admin/logins` table page. **The password is never written anywhere, not even when a failed attempt's login field holds it.** | Cheap now and needed with paying members (brief §2). A truncated attempted-login can still be a mistyped password, so the journal is admin-only. |
| P11 | **IB-072's code is deleted entirely**: `telegram-login.ts` and its spec, `POST /auth/telegram`, `loginWithTelegram`, the contract schema, the widget in `login.component`, its i18n keys and any CSP allowance. **`/auth/exchange` is deleted too.** | The widget verifier cannot serve a future Mini App: Mini App `initData` uses a different key (`HMAC("WebAppData", token)`). That is why IB-072's spec rejects it. Keeping the code would mean keeping an endpoint the page no longer uses, which the brief rules out. Git history holds it. |

`/auth/context` (bot username) stays. The login page still names the bot: "No password yet? Message
@bot `/password`."

## 3. Wire surface (`/api/web/auth`, contracts in `libs/contracts/src/insight/auth.ts`)

| Method | Path | Auth | Result |
|---|---|---|---|
| POST | `/login` `{login, password}` | public | 200 `{user}` + cookie; 401 `INVALID_CREDENTIALS`; 429 `TOO_MANY_ATTEMPTS` |
| GET | `/credentials?t=` | public | 200 `{hasLogin, login?}` (whether the page asks for a login); token errors as below, **without consuming the token** |
| POST | `/credentials` `{token, login?, password}` | public | 204; 401 `TOKEN_INVALID`; 410 `TOKEN_USED`/`TOKEN_EXPIRED`; 409 `LOGIN_TAKEN`; 422 `BAD_LOGIN`/`WEAK_PASSWORD`. The token is consumed only on success, so a taken login does not burn the link. |
| POST | `/password` `{current, next}` | session | 204; 401 `INVALID_CREDENTIALS` (throttled like login); 422 `WEAK_PASSWORD` |
| POST | `/logout-all` | session | 204 + cleared cookie |
| POST | `/logout`, GET `/me`, GET `/context` | as today | `WebUser` gains `login` |

## 4. Not now (brief §3)

No subscription states, device limit, Mini App or e-mail. Nothing here blocks them. A plan is a
column on `users` checked in `resolveSession`. A device limit is a count over `web_sessions`. E-mail
reset would be a second issuer of the same credentials token.

## 5. Tasks

- **IB-078**: server and bot (P1–P11). No dependencies.
- **IB-079**: dashboard pages. Depends on IB-078 (contracts). Shares the admin nav pattern with IB-075.
- **IB-077** acceptance amended: login + password from a phone, reset through the bot, "log out
  everywhere" kills the other device. `/setdomain` is no longer needed.
- Migration number: the next free one across **all** refs at commit time (020 is the highest on
  every ref as of 2026-11-02). WD-006 also needs one, so whichever lands second renumbers.
