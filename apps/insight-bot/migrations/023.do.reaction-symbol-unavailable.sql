-- IB-097 (Tech Lead review): a seventh refusal reason for news_reactions, `symbol_unavailable`.
-- Binance answered the klines request with error -1121 "Invalid symbol": the venue does not know the
-- perp spelling (for example a delisted contract). That answer will not change on retry, so it is
-- stored as a permanent refusal instead of being retried every pass, where enough of them would use
-- up the per-pass call cap and starve valid reactions. Every other venue error still writes no row
-- and is retried.
alter table news_reactions drop constraint news_reactions_refused_check;
alter table news_reactions add constraint news_reactions_refused_check check (refused in (
  'stale_at_ingest', 'window_not_closed', 'window_not_covered', 'no_price_at_anchor',
  'no_price_at_horizon', 'no_venue_spelling', 'symbol_unavailable'
));
