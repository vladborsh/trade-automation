-- IB-078 undo. Loses every member's login + password and the login journal: members are back to
-- having no way into the site until a login path is restored. The deleted unused tokens are not
-- restored (they were ten-minute links and would have expired anyway).
drop table if exists web_login_events;
drop table if exists web_credentials;

comment on table web_login_tokens is
  'One-time dashboard login links (IB-029). The bot''s /web creates one; the browser spends it '
  'at POST /api/web/auth/exchange. Ten minutes and single use: `used_at` is set by the same '
  'conditional UPDATE that consumes it, so a link forwarded to someone else is already dead.';
