import { describe, expect, it } from 'vitest';
import { OI_DIVERGENCE_DEFAULT_PARAMS, type WebOiDivergenceAlert } from '@trade-automation/contracts';
import { formToParams, movePct, normalizeSymbol, paramsToForm, pctText, symbolRefusalKey, toAlertRow, toSkipRow } from './alert-rows';

/** IB-112 (V12, V17) — the admin alerts page's mapping. */
const ALERT: WebOiDivergenceAlert = {
  id: 7, symbol: 'TRXUSDT', tf: '1h', direction: 'bullish',
  a: { time: 1_793_700_000, price: 0.3, oiTime: 1_793_700_300, oi: 1_000_000 },
  b: { time: 1_793_790_000, price: 0.294, oiTime: 1_793_790_300, oi: 1_068_000 },
  runOf: null, runLength: 2, params: OI_DIVERGENCE_DEFAULT_PARAMS,
  confirmedAt: Date.UTC(2026, 10, 4, 18, 0) / 1000, firedAt: Date.UTC(2026, 10, 4, 18, 6) / 1000, late: false, recipients: 1,
  priceAtFire: 0.295, price4h: 0.3009, price24h: null, outcomeAt: null,
};

describe('toAlertRow', () => {
  it('B against A for price and OI, the delivery, and the move after sending', () => {
    expect(toAlertRow(ALERT)).toEqual({
      id: 7, confirmed: '2026-11-04 18:00', symbol: 'TRXUSDT', tf: '1h', direction: 'alerts.direction.bullish',
      price: '−2.0 %', oi: '+6.8 %', run: null,
      status: { key: 'alerts.status.sent', recipients: 1 },
      after4h: '+2.0 %', after24h: '—',
    });
  });
  it('late beats everything (it was never sent); unsent and not late is «journal only» (the switch was off)', () => {
    expect(toAlertRow({ ...ALERT, late: true, firedAt: null }).status).toEqual({ key: 'alerts.status.late', recipients: 0 });
    expect(toAlertRow({ ...ALERT, firedAt: null, recipients: 0 }).status).toEqual({ key: 'alerts.status.journalOnly', recipients: 0 });
  });
  it('a repeat shows its run length; bearish says highs', () => {
    expect(toAlertRow({ ...ALERT, runLength: 3, runOf: 5 }).run).toBe(3);
    expect(toAlertRow({ ...ALERT, direction: 'bearish' }).direction).toBe('alerts.direction.bearish');
  });
});

describe('numbers', () => {
  it('one decimal, the page minus, a dash for nothing; no «−0.0»', () => {
    expect([-2, 6.84, null, -0.01].map(pctText)).toEqual(['−2.0 %', '+6.8 %', '—', '0.0 %']);
    expect(movePct(null, 1)).toBeNull();
    expect(movePct(2, 1)).toBe(-50);
  });
});

describe('the params form', () => {
  it('round-trips the defaults', () => {
    expect(formToParams(paramsToForm(OI_DIVERGENCE_DEFAULT_PARAMS))).toEqual(OI_DIVERGENCE_DEFAULT_PARAMS);
  });
  it('a comma decimal is a decimal; an empty field is not zero; out of range is refused by the contract', () => {
    const f = paramsToForm(OI_DIVERGENCE_DEFAULT_PARAMS);
    expect(formToParams({ ...f, atrMult: '0,3' })?.atrMult).toBe(0.3);
    expect(formToParams({ ...f, atrMult: '' })).toBeNull();
    expect(formToParams({ ...f, perTf: { ...f.perTf, '4h': { ...f.perTf['4h'], n: '0' } } })).toBeNull();
    expect(formToParams({ ...f, perTf: { ...f.perTf, '15m': { ...f.perTf['15m'], k: 'abc' } } })).toBeNull();
    expect(formToParams({ ...f, perTf: { ...f.perTf, '1h': { ...f.perTf['1h'], w: '7.5' } } })).toBeNull(); // whole bars only
  });
});

describe('symbols and refusals', () => {
  it('what the admin types becomes the venue spelling', () => {
    expect([' trxusdt ', 'TRX/USDT', 'trx-usdt', '1000pepe_usdt'].map(normalizeSymbol)).toEqual(['TRXUSDT', 'TRXUSDT', 'TRXUSDT', '1000PEPEUSDT']);
  });
  it('each refusal code has its sentence; an unknown code is the generic failure', () => {
    expect(['not_found', 'not_perpetual', 'not_trading', 'already_listed', 'venue_unavailable', 'nope', 3].map(symbolRefusalKey)).toEqual([
      'alerts.refused.not_found', 'alerts.refused.not_perpetual', 'alerts.refused.not_trading', 'alerts.refused.already_listed', 'alerts.refused.venue_unavailable', 'alerts.failed', 'alerts.failed',
    ]);
  });
  it('a skip row: when, the bar, and the hole as a range', () => {
    const at = Date.UTC(2026, 10, 4, 12, 6) / 1000;
    expect(toSkipRow({ symbol: 'TRXUSDT', tf: '15m', at, barTime: at - 6 * 60, reason: 'no_oi_data', holeFrom: at - 3_600, holeTo: at - 3_300 }))
      .toEqual({ at: '2026-11-04 12:06', symbol: 'TRXUSDT', tf: '15m', bar: '2026-11-04 12:00', hole: '2026-11-04 11:06 – 2026-11-04 11:11' });
  });
});
