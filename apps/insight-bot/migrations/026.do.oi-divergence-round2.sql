-- IB-114 — OI divergence round 2 (architecture/oi-divergence-design-2026-11-04.md §7, V18–V20).
-- Number 026 checked free on every ref (92 refs, 2026-11-04) before commit. 025 is MD5-frozen and
-- stays as it was: this brings its one settings row to the round-2 defaults, keeping any value the
-- owner already set on /admin/alerts.
--
-- V18: the two line tolerances, added only where absent — `||` lets the right side win, so a value
-- already in the row is kept.
update alert_settings
   set params = '{"priceLineTolAtrMult":0.25,"oiLineTolMedianMult":0.5}'::jsonb || params
 where id = 1;

-- V19: 1h lookback 120 → 168 bars (7 days), only where it is still round 1's 120. Any other value
-- is the owner's and stays.
update alert_settings
   set params = jsonb_set(params, '{perTf,1h,w}', '168'::jsonb)
 where id = 1 and params #> '{perTf,1h,w}' = '120'::jsonb;

-- updated_by / updated_at are left alone: they name the last PERSON who edited the params.
-- Journal rows (oi_divergence_alerts.params) are NOT touched: a row found before this migration was
-- found with no tolerance, and reads as 0 (V20, OiDivergenceJournalParamsSchema).
