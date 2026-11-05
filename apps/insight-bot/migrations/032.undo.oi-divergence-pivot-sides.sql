-- IB-141 undo: back to one N per TF, n = nLeft (the side that was never changed: an untouched 4h 6/2 returns to
-- 6). An owner's unequal pair cannot be expressed with one N; its left side is kept.
update alert_settings
   set params = jsonb_set(params, '{perTf}', (
         select jsonb_object_agg(e.tf, case
                  when not (e.v ? 'nLeft') then e.v
                  else (e.v - 'nLeft' - 'nRight') || jsonb_build_object('n', e.v -> 'nLeft')
                end)
           from jsonb_each(params -> 'perTf') as e(tf, v)))
 where id = 1 and jsonb_typeof(params -> 'perTf') = 'object';
