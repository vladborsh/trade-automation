-- IB-021, design §3.5, §8.6 — the bot's people: members, and the single-use invites that create
-- them. The admin is bootstrapped from ADMIN_TG_USER_ID, so this table never needs a seed row.
--
-- Unpartitioned: a private bot's membership is tens of rows, not a time series.
--
-- Migration numbers are first-come in this repo; 004 is IB-011's gap_reports, so users/invites
-- (planned as 004 when IB-021 was written) is 005.

create table if not exists users (
  id serial primary key,
  tg_user_id bigint not null unique,
  chat_id bigint,
  role text not null check (role in ('admin', 'member')),
  lang text not null default 'ru' check (lang in ('ru', 'en')),
  deposit numeric,
  risk_pct real not null default 1.0,
  daily_loss_limit_pct real,
  dex_alerts boolean not null default false,
  invited_by integer references users (id),
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table users is
  'Bot members (design §3.5). `tg_user_id` is Telegram''s own id and the identity we trust; '
  '`chat_id` is where we send, and is only known once the person has written to the bot. A '
  'person who has never started the bot has no row at all — see §8.6: an unknown user gets one '
  'line and nothing else.';
comment on column users.deposit is
  'Null until the member sets it. Position sizing needs it, so a null deposit means sizing is '
  'shown as a percentage only, never as a fabricated amount.';
comment on column users.disabled is
  'Soft delete: revoking access must not orphan the signals and outcomes already attributed to '
  'this member.';

create table if not exists invites (
  code text primary key,
  created_by integer not null references users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by integer references users (id),
  used_at timestamptz
);

comment on table invites is
  'Single-use deep links, t.me/<bot>?start=<code> (§3.5). Single use is enforced by `used_by`: '
  'the consuming update sets it in the same transaction that creates the member, so two people '
  'racing the same link cannot both join.';
comment on column invites.expires_at is
  'Seven days from creation by default. An expired invite is refused with the same message as an '
  'unknown code — an outsider probing codes learns nothing from the difference.';

-- the open-invite lookup the /start handler makes, and the admin's list
create index if not exists invites_unused_idx on invites (expires_at) where used_by is null;
create index if not exists users_role_idx on users (role) where disabled = false;
