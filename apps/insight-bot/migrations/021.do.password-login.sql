-- IB-078, architecture/password-login-design-2026-11-02.md P3, P4, P10 — the site is entered with a
-- login and a password; the bot only issues one-time CREDENTIALS links (set up / reset).
--
-- Migration 006 is not edited (postgrator checks its MD5): the change of meaning of
-- web_login_tokens is stated here, in a new comment, instead.

create table if not exists web_credentials (
  user_id integer primary key references users (id) on delete cascade,
  login text not null unique check (login ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  password_hash text not null,
  password_changed_at timestamptz not null
);

comment on table web_credentials is
  'Site login + password (IB-078, P4). One row per member at most; `login` is stored lower-cased and '
  'ASCII-only, so the UNIQUE constraint is case-insensitive by construction and look-alike Cyrillic '
  'logins cannot exist. Disabled/plan state stays on `users`, so resolveSession remains the one '
  'access predicate.';
comment on column web_credentials.password_hash is
  'scrypt$N$r$p$salt$hash (P5), self-describing so the cost can be raised later. Never the password.';

create table if not exists web_login_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id integer null references users (id) on delete set null,
  login_attempted text,
  outcome text not null check (outcome in (
    'success', 'bad_credentials', 'throttled', 'password_set', 'password_reset', 'password_changed', 'logout_all'
  )),
  ip text,
  user_agent text
);

comment on table web_login_events is
  'Login journal (IB-078, P10), kept 90 days. Admin-only: `login_attempted` is what was typed into '
  'the login field, truncated to 64, and may be a mistyped password. The password itself is never '
  'written here.';

create index if not exists web_login_events_at_idx on web_login_events (at);

-- P3: a /web LOGIN token minted before this deploy must not be spendable as a CREDENTIALS token.
delete from web_login_tokens where used_at is null;

comment on table web_login_tokens is
  'One-time CREDENTIALS links (IB-078, P1/P3; until IB-078 they were IB-029''s dashboard login '
  'links). The bot''s /start and /password create one; the browser spends it at POST '
  '/api/web/auth/credentials to set up or reset the password. It never opens a session. Ten minutes '
  'and single use; consumed only when the credentials are actually saved, by the same conditional '
  'UPDATE as before. Issuing a new link deletes that member''s unused ones.';
