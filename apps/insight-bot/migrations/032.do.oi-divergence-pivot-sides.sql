-- IB-141 — OI divergence: the pivot reach N splits into nLeft / nRight per TF; 4h becomes 6 left, 2 right
-- (owner 2026-11-05; architecture/oi-divergence-design-2026-11-04.md §10, V34). Number 032 checked free on every
-- ref (121 refs, 2026-11-05; 031 is IB-122's market_alerts) before commit. 025 / 026 are MD5-frozen and stay as
-- they were: this brings their one settings row to the new shape, keeping any value the owner set on /admin/alerts.
--
-- Per TF: nLeft = n, nRight = n, n dropped — except 4h's nRight, which becomes 2 ONLY where 4h n was 6 (the
-- default): any other 4h n is the owner's and is kept as a symmetric pair. A TF that already has no `n` is left
-- as it is, so a re-run cannot clobber it.
update alert_settings
   set params = jsonb_set(params, '{perTf}', (
         select jsonb_object_agg(e.tf, case
                  when not (e.v ? 'n') then e.v
                  else (e.v - 'n') || jsonb_build_object(
                         'nLeft', e.v -> 'n',
                         'nRight', case when e.tf = '4h' and e.v -> 'n' = '6'::jsonb then '2'::jsonb else e.v -> 'n' end)
                end)
           from jsonb_each(params -> 'perTf') as e(tf, v)))
 where id = 1 and jsonb_typeof(params -> 'perTf') = 'object';

-- updated_by / updated_at are left alone: they name the last PERSON who edited the params.
-- Journal, control and near-miss rows (their `params`) are NOT touched: each is the record of what found it.
-- A row with `n` reads as nLeft = nRight = n (V34, OiDivergenceJournalParamsSchema).
