-- IB-144 — OI hidden divergence (architecture/oi-divergence-design-2026-11-04.md §11, V41, V42). Number 033 checked
-- free on every ref (134 refs, 2026-11-06) before commit; IB-124 / 126 / 128 move to 034 / 035 / 036.
--
-- V41: `kind` (regular | hidden) on the journal and the near-misses. Every row that exists now is regular, so the
-- column is added with default 'regular' and the default is then DROPPED (028's pattern): a writer that does not
-- say which kind it means fails at once instead of passing for regular. Paths inherit kind from their subject;
-- controls have no kind of their own (a pivot control is «a pivot with no REGULAR alert», unchanged — V41).
alter table oi_divergence_alerts add column kind text not null default 'regular' check (kind in ('regular', 'hidden'));
alter table oi_divergence_alerts alter column kind drop default;
alter table oi_divergence_near_misses add column kind text not null default 'regular' check (kind in ('regular', 'hidden'));
alter table oi_divergence_near_misses alter column kind drop default;

-- The once-keys gain kind: one B can be both kinds (with different A's), and a near-miss is per B per kind.
alter table oi_divergence_alerts drop constraint oi_divergence_alerts_once;
alter table oi_divergence_alerts add constraint oi_divergence_alerts_once unique (source, symbol, tf, kind, direction, a_time, b_time);
alter table oi_divergence_near_misses drop constraint oi_divergence_near_misses_once;
alter table oi_divergence_near_misses add constraint oi_divergence_near_misses_once unique (source, symbol, tf, kind, direction, b_time);

comment on column oi_divergence_alerts.kind is
  'regular = V7 (bullish: price lower low, OI higher; bearish: price higher high, OI lower); hidden = V40, (1) and (2) '
  'flipped (bullish: higher low, OI lower; bearish: lower high, OI higher). Two different claims: any statistic '
  'reports them separately. Controls are «a pivot with no REGULAR alert»: a hidden-vs-control comparison must '
  'exclude the overlap (the pivot B of a hidden alert can also be a control) in its own query (design V41, V32).';
comment on column oi_divergence_near_misses.kind is
  'regular | hidden (IB-144, V41): the kind whose conditions the candidate missed by exactly one; at most one per B per kind.';

-- V42: the hidden switch per TF, OFF: merging IB-144 is not a go-live (V47's guard switches a TF on). Only where the
-- key is absent, so a re-run cannot clobber a value already set; updated_by / updated_at name the last PERSON.
update alert_settings
   set params = jsonb_set(params, '{perTf}', (
         select jsonb_object_agg(e.tf, case when e.v ? 'sendHidden' then e.v else e.v || '{"sendHidden": false}'::jsonb end)
           from jsonb_each(params -> 'perTf') as e(tf, v)))
 where id = 1 and jsonb_typeof(params -> 'perTf') = 'object';
