-- IB-097 undo: the old constraint cannot hold a `symbol_unavailable` row, so those rows are deleted
-- first. With no row, the reaction is pending again and the service asks the venue on its next pass.
delete from news_reactions where refused = 'symbol_unavailable';
alter table news_reactions drop constraint news_reactions_refused_check;
alter table news_reactions add constraint news_reactions_refused_check check (refused in (
  'stale_at_ingest', 'window_not_closed', 'window_not_covered', 'no_price_at_anchor',
  'no_price_at_horizon', 'no_venue_spelling'
));
