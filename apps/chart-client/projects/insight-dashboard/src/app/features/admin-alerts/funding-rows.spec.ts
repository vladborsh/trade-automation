import type { WebFundingAlertRow, WebFundingCoin } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { coinsToFundingForm, floorText, fundingPerCoinPatch, parseHours, parsePercent, pctText, toFundingRow } from './funding-rows';

/** IB-124 (F3, F5) — the «Funding» section's pure mapping: rows, the floor form in percent, the patch of changes only. */
const COINS: WebFundingCoin[] = [
  { symbol: 'BTCUSDT', base: 'BTC', listed: true, enabled: true, floorPer8h: null },
  { symbol: 'TRXUSDT', base: 'TRX', listed: false, enabled: true, floorPer8h: 0.0005 },
];
const ROW: WebFundingAlertRow = {
  id: 1, source: 'live', event: 'flip', symbol: 'BTCUSDT', side: 'high', at: Date.UTC(2026, 10, 6, 1, 5) / 1000,
  rate: -0.00005, intervalH: 4, ratePer8h: -0.0001, episodeHours: 31.9, firedAt: null, late: false, recipients: 0, mutedBy: null,
};

describe('funding rows (IB-124)', () => {
  it('a journal row: the venue rate with its interval, per 8 h, the episode in whole hours (never rounded up)', () => {
    expect(toFundingRow(ROW)).toMatchObject({
      symbol: 'BTCUSDT', side: 'fundingAlerts.side.high', event: 'fundingAlerts.event.flip',
      rate: '−0.0050% / 4h', per8h: '−0.0100%', episode: '31h', status: { key: 'alerts.status.journalOnly' },
    });
    expect(toFundingRow({ ...ROW, event: 'enter', episodeHours: null, intervalH: null, firedAt: 1, recipients: 2 })).toMatchObject({
      episode: '—', rate: '−0.0050% / ?h', status: { key: 'alerts.status.sent', recipients: 2 },
    });
    expect(toFundingRow({ ...ROW, source: 'backfill' }).status.key).toBe('alerts.status.history');
  });

  it('percent both ways: 0.0003 ↔ «0.03»; comma and % accepted; zero, negatives and words refused', () => {
    expect([pctText(0.000412), floorText(0.0003), floorText(0.00055)]).toEqual(['+0.0412%', '0.03', '0.055']);
    expect([parsePercent('0.05'), parsePercent('0,05'), parsePercent(' 0.05 % '), parsePercent('0'), parsePercent('-0.05'), parsePercent('abc')])
      .toEqual([0.0005, 0.0005, 0.0005, null, null, null]);
  });

  it('the form shows an own floor in percent and an empty field for the shared default', () => {
    expect(coinsToFundingForm(COINS).map((c) => c.floor)).toEqual(['', '0.05']);
  });

  it('the patch carries only changed coins; clearing a floor sends null (back to the default); a bad floor blocks saving', () => {
    const form = coinsToFundingForm(COINS);
    expect(fundingPerCoinPatch(form, COINS)).toEqual({});
    expect(fundingPerCoinPatch(form.map((c) => (c.symbol === 'BTCUSDT' ? { ...c, floor: '0.04' } : c)), COINS)).toEqual({ BTCUSDT: { enabled: true, floorPer8h: 0.0004 } });
    expect(fundingPerCoinPatch(form.map((c) => (c.symbol === 'TRXUSDT' ? { ...c, floor: '' } : c)), COINS)).toEqual({ TRXUSDT: { enabled: true, floorPer8h: null } });
    expect(fundingPerCoinPatch(form.map((c) => (c.symbol === 'BTCUSDT' ? { ...c, enabled: false } : c)), COINS)).toEqual({ BTCUSDT: { enabled: false, floorPer8h: null } });
    expect(fundingPerCoinPatch(form.map((c) => (c.symbol === 'BTCUSDT' ? { ...c, floor: 'x' } : c)), COINS)).toBeNull();
    expect(fundingPerCoinPatch(form.map((c) => (c.symbol === 'BTCUSDT' ? { ...c, floor: '2' } : c)), COINS)).toBeNull(); // > 1 %/8 h
  });

  it('hours: positive, at most 720', () => {
    expect([parseHours('24'), parseHours('12,5'), parseHours('0'), parseHours('721'), parseHours('')]).toEqual([24, 12.5, null, null, null]);
  });
});
