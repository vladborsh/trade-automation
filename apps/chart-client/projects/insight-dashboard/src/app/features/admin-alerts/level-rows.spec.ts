import type { WebLevelAlertRow, WebLevelCoin } from '@trade-automation/contracts';
import { bandText, coinsToLevelForm, eventGrid, eventsPatch, levelPerCoinPatch, parseBandPct, priceText, toLevelRow } from './level-rows';

/** IB-126 — the «Levels» section's mapping. */
describe('level rows', () => {
  const row: WebLevelAlertRow = { id: 1, source: 'live', event: 'crossunder', symbol: 'BTCUSDT', kind: 'PWH', price: 71850, at: Date.UTC(2026, 10, 6, 14, 45) / 1000, close: 71600.5, firedAt: null, late: false, recipients: 0 };

  it('a journal row: UTC minute, kind as is, the event\'s key, the status', () => {
    expect(toLevelRow(row)).toEqual({ id: 1, at: '2026-11-06 14:45', symbol: 'BTCUSDT', kind: 'PWH', event: 'levelAlerts.event.crossunder', price: '71850', close: '71600.5', status: { key: 'alerts.status.journalOnly', recipients: 0 } });
    expect(toLevelRow({ ...row, late: true }).status.key).toBe('alerts.status.late');
    expect(toLevelRow({ ...row, firedAt: 1, recipients: 3 }).status).toEqual({ key: 'alerts.status.sent', recipients: 3 });
    expect(toLevelRow({ ...row, source: 'backfill' }).status.key).toBe('alerts.status.history');
    expect(priceText(0.31245678912)).toBe('0.31245679');
  });

  it('the event grid: a cell only where the event applies; absent = on', () => {
    const g = eventGrid({ PWH: { crossunder: false } });
    expect(g.map((r) => r.kind)).toEqual(['PWH', 'PWL', 'PMH', 'PML', 'WO', 'MO', 'PDH', 'PDL']);
    expect(g[0].cells).toEqual([{ event: 'breakout_up', on: true }, null, { event: 'sweep_above', on: true }, null, { event: 'crossunder', on: false }, null]);
    expect(g[4].cells.filter((c) => c !== null).map((c) => c?.event)).toEqual(['breakout_up', 'breakout_down', 'sweep_above', 'sweep_below']);
  });

  it('the events patch carries only the changed cells, true or false', () => {
    const server = { PWH: { breakout_up: true, sweep_above: true, crossunder: false } };
    const g = eventGrid(server);
    expect(eventsPatch(g, server)).toEqual({});
    g[0].cells[4] = { event: 'crossunder', on: true };
    g[1].cells[5] = { event: 'crossover', on: false };
    expect(eventsPatch(g, server)).toEqual({ PWH: { crossunder: true }, PWL: { crossover: false } });
  });

  it('the coins patch carries only changed coins', () => {
    const coins: WebLevelCoin[] = [{ symbol: 'BTCUSDT', base: 'BTC', listed: true, enabled: true, daily: false, stateRows: 4 }, { symbol: 'ETHUSDT', base: 'ETH', listed: true, enabled: true, daily: false, stateRows: 0 }];
    const form = coinsToLevelForm(coins);
    expect(levelPerCoinPatch(form, coins)).toEqual({});
    form[1] = { ...form[1], daily: true };
    expect(levelPerCoinPatch(form, coins)).toEqual({ ETHUSDT: { enabled: true, daily: true } });
  });

  it('the touch band in percent both ways; nonsense is null', () => {
    expect([parseBandPct('0.1'), parseBandPct('0,25'), parseBandPct(''), parseBandPct('0'), parseBandPct('6'), parseBandPct('x')]).toEqual([0.001, 0.0025, null, null, null, null]);
    expect(bandText(0.001)).toBe('0.1');
  });
});
