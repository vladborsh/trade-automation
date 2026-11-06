import { HttpException } from '@nestjs/common';
import { WEB_MAX_ALERT_MARKS, WebAlertMarksResponseSchema } from '@trade-automation/contracts';
import type { Db } from '../../src/db/db.port';
import { AlertMarksController } from '../../src/web/series/alert-marks.controller';
import { alertMarksResponse, toAlertMark, type AlertMarkRow } from '../../src/web/series/alert-marks';
import { AT, enterDetails, flipDetails, liqDetails } from './alert-marks.fixtures';

/** IB-129 (alerts design §5) — journal rows → the instrument chart's marks. */

const AT_SEC = AT.getTime() / 1000;

const row = (type: string, event: string, details: unknown, at = AT): AlertMarkRow => ({ type, event, at, details });

describe('IB-129 alert marks: the mapping', () => {
  it('a liquidation crossing: its moment, the liquidated side, the sum, the threshold and the venue split', () => {
    expect(toAlertMark(row('liq', 'alert', liqDetails))).toEqual({
      type: 'liq', at: AT_SEC, side: 'long', sumUsd: 7.4e6, thresholdUsd: 5e6, byVenue: { binance: 3.1e6, bybit: 2.9e6, okx: 1.4e6 },
    });
  });

  it('funding enter and flip: the episode side and the 8 h rate; only a flip has the episode length', () => {
    expect(toAlertMark(row('funding', 'enter', enterDetails))).toEqual({
      type: 'funding', event: 'enter', at: AT_SEC, side: 'high', ratePer8h: 0.0008, episodeHours: null,
    });
    expect(toAlertMark(row('funding', 'flip', flipDetails))).toMatchObject({ event: 'flip', side: 'high', episodeHours: 31.5 });
  });

  it('a row that is not a mark (event rows, levels) or whose details break the contract maps to nothing', () => {
    expect(toAlertMark(row('liq', 'event', liqDetails))).toBeNull();
    expect(toAlertMark(row('level', 'breakout_up', {}))).toBeNull();
    expect(toAlertMark(row('liq', 'alert', { ...liqDetails, side: 'sideways' }))).toBeNull();
    expect(toAlertMark(row('funding', 'flip', enterDetails))).toBeNull(); // an enter's details on a flip row
  });

  it('the answer is oldest first, parses as the contract, and counts the rows it left out', () => {
    const rows = [row('funding', 'enter', enterDetails, new Date(AT.getTime() + 60_000)), row('liq', 'alert', { bad: 1 }), row('liq', 'alert', liqDetails)];
    const { response, dropped } = alertMarksResponse('BTCUSDT', rows);
    expect(response.marks.map((m) => m.type)).toEqual(['liq', 'funding']);
    expect(dropped).toBe(1);
    expect(response.truncated).toBe(false);
    expect(WebAlertMarksResponseSchema.parse(response)).toEqual(response);
  });

  it('one row over the cap: truncated, and the NEWEST cap rows are the ones kept', () => {
    const rows = Array.from({ length: WEB_MAX_ALERT_MARKS + 1 }, (_, i) => row('liq', 'alert', liqDetails, new Date(AT.getTime() - i * 60_000)));
    const { response } = alertMarksResponse('BTCUSDT', rows);
    expect(response.truncated).toBe(true);
    expect(response.marks).toHaveLength(WEB_MAX_ALERT_MARKS);
    expect(response.marks[response.marks.length - 1].at).toBe(AT_SEC); // the newest row is in
    expect(response.marks[0].at).toBe(AT_SEC - (WEB_MAX_ALERT_MARKS - 1) * 60); // the oldest one is out
    expect(WebAlertMarksResponseSchema.safeParse(response).success).toBe(true);
  });
});

describe('IB-129 alert marks: the route', () => {
  const fakeDb = (rows: AlertMarkRow[] = []) => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const db: Db = {
      query: async (sql: string, params: readonly unknown[] = []) => { calls.push({ sql, params }); return rows as never; },
      transaction: async (fn) => fn(db),
    };
    return { db, calls };
  };
  const status = async (p: Promise<unknown>) => p.then(() => 200, (e: HttpException) => e.getStatus());

  it('one read for the window, with the symbol and the window as asked', async () => {
    const { db, calls } = fakeDb([row('liq', 'alert', liqDetails)]);
    const res = await new AlertMarksController(db).alertMarks('BTCUSDT', String(AT.getTime() - 86_400_000), String(AT.getTime() + 1));
    expect(res.marks).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].params.slice(0, 3)).toEqual(['BTCUSDT', new Date(AT.getTime() - 86_400_000), new Date(AT.getTime() + 1)]);
  });

  it('refuses a bad symbol or window before the database; no database is a 503', async () => {
    const { db, calls } = fakeDb();
    const c = new AlertMarksController(db);
    expect(await status(c.alertMarks('btc usdt', '0', '1'))).toBe(400);
    expect(await status(c.alertMarks('BTCUSDT', 'x', '1'))).toBe(400);
    expect(await status(c.alertMarks('BTCUSDT', '10', '5'))).toBe(400);
    expect(calls).toHaveLength(0);
    expect(await status(new AlertMarksController(null).alertMarks('BTCUSDT', '0', '1'))).toBe(503);
  });

  it('any width is accepted: the 1m 90-day rule is about bars (a year of marks is one read)', async () => {
    const { db } = fakeDb();
    expect(await status(new AlertMarksController(db).alertMarks('BTCUSDT', '0', String(400 * 86_400_000)))).toBe(200);
  });
});
