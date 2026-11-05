import type { WebLiqAlertRow, WebLiqCoin } from '@trade-automation/contracts';
import { coinsToForm, parseUsd, perCoinPatch, toLiqRow, usdText } from './liq-rows';

describe('IB-122 liq-rows', () => {
  const row: WebLiqAlertRow = {
    id: 1, source: 'live', event: 'alert', symbol: 'BTCUSDT', side: 'long', at: Date.UTC(2026, 10, 5, 14, 7) / 1000,
    sumUsd: 7.4e6, thresholdUsd: 5e6, firedAt: null, late: false, recipients: 0,
  };
  const coins: WebLiqCoin[] = [
    { symbol: 'BTCUSDT', base: 'BTC', listed: true, enabled: true, thresholdUsd: 5e6 },
    { symbol: 'DOGEUSDT', base: 'DOGE', listed: true, enabled: false, thresholdUsd: null },
  ];

  it('a journal row: money as the bot writes it, the status from source / late / fired', () => {
    expect(toLiqRow(row)).toEqual({
      id: 1, at: '2026-11-05 14:07', symbol: 'BTCUSDT', side: 'liqAlerts.side.long', event: 'liqAlerts.event.alert',
      sum: '$7.4M', threshold: '$5M', status: { key: 'alerts.status.journalOnly', recipients: 0 },
    });
    expect(toLiqRow({ ...row, firedAt: 1, recipients: 2 }).status).toEqual({ key: 'alerts.status.sent', recipients: 2 });
    expect(toLiqRow({ ...row, late: true }).status.key).toBe('alerts.status.late');
    expect(toLiqRow({ ...row, source: 'backfill' }).status.key).toBe('alerts.status.history');
    expect(toLiqRow({ ...row, event: 'continuing', side: 'short' })).toMatchObject({ side: 'liqAlerts.side.short', event: 'liqAlerts.event.continuing' });
  });

  it('money and typed thresholds', () => {
    expect([950, 300_000, 5e6, 12.6e6].map(usdText)).toEqual(['$950', '$300k', '$5M', '$13M']);
    expect(['5 000 000', '5,000,000', '300000', '0', '-1', '5M', ''].map(parseUsd)).toEqual([5e6, 5e6, 3e5, null, null, null, null]);
  });

  it('only changed coins go in the patch; a coin switched on needs a threshold; a bad number blocks saving', () => {
    const form = coinsToForm(coins);
    expect(perCoinPatch(form, coins)).toEqual({});
    expect(perCoinPatch([{ ...form[0]!, threshold: '6 000 000' }, form[1]!], coins)).toEqual({ BTCUSDT: { enabled: true, thresholdUsd: 6e6 } });
    expect(perCoinPatch([form[0]!, { ...form[1]!, enabled: true }], coins)).toBeNull();
    expect(perCoinPatch([form[0]!, { ...form[1]!, enabled: true, threshold: '200000' }], coins)).toEqual({ DOGEUSDT: { enabled: true, thresholdUsd: 2e5 } });
    expect(perCoinPatch([{ ...form[0]!, threshold: 'lots' }, form[1]!], coins)).toBeNull();
    expect(perCoinPatch([{ ...form[0]!, enabled: false }, form[1]!], coins)).toEqual({ BTCUSDT: { enabled: false, thresholdUsd: 5e6 } });
  });
});
