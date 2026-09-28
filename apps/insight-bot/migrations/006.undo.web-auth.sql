drop index if exists web_login_tokens_expires_idx;
drop index if exists web_sessions_expires_idx;
drop index if exists web_login_tokens_user_idx;
drop index if exists web_sessions_user_idx;
drop table if exists web_sessions;
drop table if exists web_login_tokens;
