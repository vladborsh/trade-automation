import {
  FundingEnterDetailsSchema, FundingFlipDetailsSchema, LiqAlertDetailsSchema, WEB_MAX_ALERT_MARKS,
  type WebAlertMark, type WebAlertMarksResponse,
} from '@trade-automation/contracts';

/**
 * IB-129 (alerts design §5) — `market_alerts` rows → the chart's marks. Pure; the SQL picks the rows
 * (`pg/alert-marks.repo.ts`: live, not late, liq `alert` and funding `enter`/`flip`), this decides what each
 * row says. The rules on which rows are marks are the contract's (`alert-marks.ts` in contracts).
 *
 * A row whose `details` do not parse as its event's contract is DROPPED, not guessed at, and counted: the
 * writers validate on write, so a bad row is a defect elsewhere, and one bad row must not cost the chart its
 * other marks. The count goes to the log by the caller.
 */
export interface AlertMarkRow {
  type: string;
  event: string;
  at: Date;
  details: unknown;
}

const sec = (d: Date) => Math.floor(new Date(d).getTime() / 1000);

export function toAlertMark(row: AlertMarkRow): WebAlertMark | null {
  if (row.type === 'liq' && row.event === 'alert') {
    const d = LiqAlertDetailsSchema.safeParse(row.details);
    if (!d.success) return null;
    return { type: 'liq', at: sec(row.at), side: d.data.side, sumUsd: d.data.sumUsd, thresholdUsd: d.data.thresholdUsd, byVenue: d.data.byVenue };
  }
  if (row.type === 'funding' && row.event === 'enter') {
    const d = FundingEnterDetailsSchema.safeParse(row.details);
    if (!d.success) return null;
    return { type: 'funding', event: 'enter', at: sec(row.at), side: d.data.side, ratePer8h: d.data.ratePer8h, episodeHours: null };
  }
  if (row.type === 'funding' && row.event === 'flip') {
    const d = FundingFlipDetailsSchema.safeParse(row.details);
    if (!d.success) return null;
    return { type: 'funding', event: 'flip', at: sec(row.at), side: d.data.side, ratePer8h: d.data.ratePer8h, episodeHours: d.data.episodeHours };
  }
  return null;
}

/**
 * The response from the rows as read: NEWEST first, at most `WEB_MAX_ALERT_MARKS + 1` (the extra row only
 * says the window had more). Answered oldest first, the newest kept.
 */
export function alertMarksResponse(symbol: string, newestFirst: readonly AlertMarkRow[]): { response: WebAlertMarksResponse; dropped: number } {
  const truncated = newestFirst.length > WEB_MAX_ALERT_MARKS;
  const kept = newestFirst.slice(0, WEB_MAX_ALERT_MARKS);
  const marks = kept.map(toAlertMark);
  const valid = marks.filter((m): m is WebAlertMark => m !== null);
  return { response: { symbol, marks: valid.reverse(), truncated }, dropped: marks.length - valid.length };
}
