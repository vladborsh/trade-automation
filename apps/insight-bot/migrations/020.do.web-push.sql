-- IB-069 — browser Web Push for the calendar reminder. Number checked free across every ref on
-- 2026-10-29 before commit (highest anywhere was 019; WD-006 has not taken one yet and is told to
-- take the next free number, which is now 021 or higher).
--
-- A subscription belongs to the member whose session posted it. The endpoint is its identity: the
-- same browser re-subscribing updates its keys rather than adding a second row, so it never rings
-- twice. Deleted when the member unsubscribes or the push service answers 404/410.

create table if not exists web_push_subscriptions (
  id serial primary key,
  user_id integer not null references users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists web_push_subscriptions_user_idx on web_push_subscriptions (user_id);

comment on table web_push_subscriptions is
  'Browser push subscriptions for the calendar reminder (IB-069), one per browser, tied to the '
  'member of the web session that created it.';

-- The dedup journal, keyed on (subscription, key) — the Telegram journal's keys (due:<epoch ms>)
-- per browser, not per member: a member with two browsers gets the reminder in both, once each.
create table if not exists web_push_notifications_sent (
  subscription_id integer not null references web_push_subscriptions (id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (subscription_id, key)
);

comment on table web_push_notifications_sent is
  'Dedup journal for calendar web pushes (IB-069). The row is written before the push is sent, so '
  'a restart never repeats one — at the cost that a push that fails after the claim is not retried.';
