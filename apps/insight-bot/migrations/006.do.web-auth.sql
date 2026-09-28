-- IB-029, design architecture/insight-bot-web-dashboard.md §1 W3, §4 — signing in to the
-- dashboard from Telegram: the bot hands out a short-lived one-time token, the browser exchanges
-- it for a session cookie.
--
-- **Only hashes are stored.** Both tables keep sha256(token), never the token itself, so a
-- leaked database cannot be replayed into a live session or a login link. This is the backtest
-- app's pattern (§7.1); the tables and the cookie are this app's own.

create table if not exists web_login_tokens (
  token_hash text primary key,
  user_id integer not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

comment on table web_login_tokens is
  'One-time dashboard login links (IB-029). The bot''s /web creates one; the browser spends it '
  'at POST /api/web/auth/exchange. Ten minutes and single use: `used_at` is set by the same '
  'conditional UPDATE that consumes it, so a link forwarded to someone else is already dead.';
comment on column web_login_tokens.token_hash is
  'sha256 of the 32 random bytes in the link. The plaintext exists only in the Telegram message.';
comment on column web_login_tokens.used_at is
  'Set on consumption. A used token is kept rather than deleted so the exchange can answer 410 '
  'TOKEN_USED instead of a bare "invalid" — the person clicked their own real link twice, and '
  'telling them so is not a leak.';

create table if not exists web_sessions (
  id text primary key,
  user_id integer not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);

comment on table web_sessions is
  'Dashboard sessions (IB-029). `id` IS sha256(cookie token) — the row is found by hashing the '
  'cookie, so the table never holds anything that can be presented as a credential. Sliding '
  '30 days, refreshed when last_seen_at is over an hour old.';

create index if not exists web_sessions_user_idx on web_sessions (user_id);
create index if not exists web_login_tokens_user_idx on web_login_tokens (user_id);
-- the sweep of expired rows; both tables are small, but neither should grow forever
create index if not exists web_sessions_expires_idx on web_sessions (expires_at);
create index if not exists web_login_tokens_expires_idx on web_login_tokens (expires_at);
