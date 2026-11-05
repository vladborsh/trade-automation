-- IB-130 undo: the recorded dominance goes with the columns (CoinGecko cannot give it back); the cap stays.
alter table market_cap_total
  drop column if exists btc_pct,
  drop column if exists eth_pct;
