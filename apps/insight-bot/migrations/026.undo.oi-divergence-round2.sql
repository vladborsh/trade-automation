-- IB-114 undo: the settings row back to round 1's keys. The tolerances go whatever their value (round-1
-- code has no use for them); a 1h W of 168 goes back to 120 — this cannot tell 026's 168 from one the
-- owner typed, and says so. Journal rows were never touched.
update alert_settings
   set params = params - 'priceLineTolAtrMult' - 'oiLineTolMedianMult'
 where id = 1;
update alert_settings
   set params = jsonb_set(params, '{perTf,1h,w}', '120'::jsonb)
 where id = 1 and params #> '{perTf,1h,w}' = '168'::jsonb;
