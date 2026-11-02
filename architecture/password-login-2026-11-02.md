# Brief — site login by login + password, "log out everywhere" (2026-11-02)

**Author:** coordinator (product session with the user) · **For:** Architect (insight-bot stream) —
design and decompose into `tasks/insight-bot.jsonl`. Amends `member-access-2026-10-31.md` and
`member-access-design-2026-10-31.md` (M1–M3, IB-072, IB-077).

## 1. User rulings, 2026-11-02

1. **The site's login page is login + password only.** "Log in with Telegram" (IB-072, merged
   6fa405c) comes off the site. The one-time `/web` link from the bot is no longer a way in either,
   unless the Architect finds it is needed as the password-setup / reset path below.
2. **Accounts come from invites, as now.** An invited person gets an account and **chooses their own
   login and password** on a registration page. No open sign-up, no e-mail.
3. **Forgotten password → reset through the Telegram bot.** The bot sends a one-time reset link;
   the page sets a new password. So every account must stay linked to a Telegram user
   (`users.tg_user_id`) — the bot remains the identity anchor and the notification channel, it is
   just not the way into the site.
4. **"Log out everywhere"** button: ends every session of the account at once
   (`WebAuthService.revokeUser` already deletes all of a user's sessions).

Sessions themselves are unchanged: opaque token in an `HttpOnly`/`Secure`/`SameSite=Lax` cookie,
only its sha256 stored, 30-day sliding expiry, access re-checked against `users` on every call.

## 2. What the design must settle (Architect)

- **The invite → account flow.** Today: `/invite` → bot link → `/start` creates the `users` row with
  the Telegram id. Where does "choose login + password" happen so the account is linked to Telegram
  from the start (e.g. the bot answers `/start` with a one-time "set up your site login" link)?
- **Existing members**, the admin first: how they get a password (same one-time link from the bot).
- **Password storage:** a slow, salted hash (argon2id or bcrypt — pick one and say why); minimum
  length; login unique case-insensitively.
- **Brute force:** rate limit per login and per IP on the login endpoint; one generic error for
  "no such login" and "wrong password".
- **Reset and change password end every other session** of the account.
- **A login journal** (time, IP from Cloudflare's header, user agent) visible to the admin — cheap
  now, needed once there are paying members.
- **What happens to IB-072's code** (verifier, `/api/web/auth/telegram`): delete, or keep the
  verifier for a later Telegram Mini App (queued, not ruled). Do not leave a live endpoint that the
  page no longer uses.
- **IB-077 acceptance** changes: log in with login + password from a phone, reset through the bot,
  "log out everywhere" really kills the other device's session. `/setdomain` in BotFather is no
  longer needed for the site.

## 3. Not now

Subscription states, device limit, Telegram Mini App, e-mail. Do not build for them; do not make
them harder (one access predicate in `resolveSession`, as `member-access-design` §4 says).
