import { WEB_MAX_ALERT_MARKS } from '@trade-automation/contracts';
import type { Db } from '../../../db/db.port';
import type { AlertMarkRow } from '../alert-marks';

/**
 * IB-129 — the chart's alert marks for one coin and window: ONE read of `market_alerts`, no venue call
 * (alerts design §5). Which rows are marks is the contract's rule (`alert-marks.ts` in contracts): the live
 * loop's rows that were not late — liquidation crossings (`alert`) and funding `enter` / `flip`.
 *
 * Newest first with one row over the cap, so the caller can say the window was cut and keep the newest.
 * `type in (…) and symbol and at` is the prefix of `market_alerts_type_symbol_at_idx (type, symbol, at desc)`, so the
 * index can bound all three; the event rule is a filter on what it finds. A few rows a day: cheap either way.
 */
export async function alertMarkRows(db: Db, symbol: string, fromMs: number, toMs: number): Promise<AlertMarkRow[]> {
  return db.query<AlertMarkRow>(
    `select type, event, at, details from market_alerts
      where type in ('liq', 'funding') and symbol = $1 and at >= $2 and at < $3
        and source = 'live' and not late
        and ((type = 'liq' and event = 'alert') or (type = 'funding' and event in ('enter', 'flip')))
      order by at desc, id desc
      limit $4`,
    [symbol, new Date(fromMs), new Date(toMs), WEB_MAX_ALERT_MARKS + 1],
  );
}
