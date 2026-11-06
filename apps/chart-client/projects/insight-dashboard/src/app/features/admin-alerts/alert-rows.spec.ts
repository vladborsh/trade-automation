import { describe, expect, it } from 'vitest';
import { OI_DIVERGENCE_DEFAULT_PARAMS, type WebOiDivergenceAlert } from '@trade-automation/contracts';
import { MUTED_STATUS_KEY, alertKindKey, formToParams, marketAlertStatus, movePct, normalizeSymbol, paramsToForm, pctText, symbolRefusalKey, toAlertRow, toSkipRow } from './alert-rows';
import { dateTime } from '../../shared/time-format';

/** IB-152: a UTC `YYYY-MM-DD HH:MM[:SS]` as the viewer sees it (time-format.spec pins the zones). */
const local = (utc: string): string => dateTime(Date.parse(`${utc.replace(' ', 'T')}Z`) / 1000);

/** IB-112 (V12, V17) — the admin alerts page's mapping. */
const ALERT: WebOiDivergenceAlert = {
  id: 7, source: 'live', symbol: 'TRXUSDT', tf: '1h', direction: 'bullish', kind: 'regular',
  a: { time: 1_793_700_000, price: 0.3, oiTime: 1_793_700_300, oi: 1_000_000 },
  b: { time: 1_793_790_000, price: 0.294, oiTime: 1_793_790_300, oi: 1_068_000 },
  runOf: null, runLength: 2, params: OI_DIVERGENCE_DEFAULT_PARAMS,
  confirmedAt: Date.UTC(2026, 10, 4, 18, 0) / 1000, firedAt: Date.UTC(2026, 10, 4, 18, 6) / 1000, late: false, recipients: 1,
  priceAtFire: 0.295, price4h: 0.3009, price24h: null, outcomeAt: null,
};

describe('IB-151 marketAlertStatus (liq, funding, level rows)', () => {
  const live = { source: 'live' as const, late: false, firedAt: null, recipients: 0, mutedBy: null };
  it('a muted row names its switch first — not «journal only», not late, not history', () => {
    expect(marketAlertStatus({ ...live, mutedBy: 'event' })).toEqual({ key: 'alerts.status.muted.event', recipients: 0 });
    expect(marketAlertStatus({ ...live, mutedBy: 'coin', late: true })).toEqual({ key: 'alerts.status.muted.coin', recipients: 0 });
    expect(marketAlertStatus({ ...live, mutedBy: 'daily', source: 'backfill' })).toEqual({ key: 'alerts.status.muted.daily', recipients: 0 });
    expect(MUTED_STATUS_KEY.custom_event).toBe('alerts.status.muted.custom_event');
  });
  it('unmuted: history, late, sent, journal only — as before', () => {
    expect(marketAlertStatus({ ...live, source: 'backfill' }).key).toBe('alerts.status.history');
    expect(marketAlertStatus({ ...live, late: true }).key).toBe('alerts.status.late');
    expect(marketAlertStatus({ ...live, firedAt: 1, recipients: 2 })).toEqual({ key: 'alerts.status.sent', recipients: 2 });
    expect(marketAlertStatus(live).key).toBe('alerts.status.journalOnly');
  });
});

describe('toAlertRow', () => {
  it('B against A for price and OI, the delivery, and the move after sending', () => {
    expect(toAlertRow(ALERT)).toEqual({
      id: 7, confirmed: local('2026-11-04 18:00'), symbol: 'TRXUSDT', tf: '1h', direction: 'alerts.direction.bullish', kind: null,
      price: '−2.0 %', oi: '+6.8 %', run: null,
      status: { key: 'alerts.status.sent', recipients: 1 },
      after4h: '+2.0 %', after24h: '—',
    });
  });
  it('late beats everything (it was never sent); unsent and not late is «journal only» (the switch was off)', () => {
    expect(toAlertRow({ ...ALERT, late: true, firedAt: null }).status).toEqual({ key: 'alerts.status.late', recipients: 0 });
    expect(toAlertRow({ ...ALERT, firedAt: null, recipients: 0 }).status).toEqual({ key: 'alerts.status.journalOnly', recipients: 0 });
  });
  it('IB-116 (V33): a backfilled row says «from history» — not «journal only», not late, whatever its other fields', () => {
    const history = { ...ALERT, source: 'backfill' as const, firedAt: null, recipients: 0, late: false };
    expect(toAlertRow(history).status).toEqual({ key: 'alerts.status.history', recipients: 0 });
    expect(toAlertRow({ ...history, source: 'live' }).status).toEqual({ key: 'alerts.status.journalOnly', recipients: 0 });
  });
  it('IB-144 (V44): a hidden row is labelled «скрытая дивергенция OI»; a regular one carries no label (today\'s look)', () => {
    expect(toAlertRow({ ...ALERT, kind: 'hidden' }).kind).toBe('alerts.kind.hidden');
    expect(toAlertRow({ ...ALERT, kind: 'hidden', direction: 'bearish' })).toMatchObject({ kind: 'alerts.kind.hidden', direction: 'alerts.direction.bearish' });
    expect(toAlertRow(ALERT).kind).toBeNull();
    expect([alertKindKey('hidden'), alertKindKey('regular')]).toEqual(['alerts.kind.hidden', null]);
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
  it('IB-141: each side is its own field — 4h shows 6 left and 2 right, and an edited side goes back on that side only', () => {
    const f = paramsToForm(OI_DIVERGENCE_DEFAULT_PARAMS);
    expect(f.perTf['4h']).toEqual({ nLeft: '6', nRight: '2', k: '3', w: '90', sendHidden: false });
    expect(formToParams({ ...f, perTf: { ...f.perTf, '1h': { ...f.perTf['1h'], nRight: '3' } } })?.perTf['1h']).toEqual({ nLeft: 6, nRight: 3, k: 3, w: 168, sendHidden: false });
  });
  it('IB-144 (V42): sendHidden per TF is carried both ways — on for 15m only stays on 15m only, and is never dropped', () => {
    const f = paramsToForm({ ...OI_DIVERGENCE_DEFAULT_PARAMS, perTf: { ...OI_DIVERGENCE_DEFAULT_PARAMS.perTf, '15m': { ...OI_DIVERGENCE_DEFAULT_PARAMS.perTf['15m'], sendHidden: true } } });
    expect(f.perTf['15m'].sendHidden).toBe(true);
    const back = formToParams(f)!;
    expect([back.perTf['15m'].sendHidden, back.perTf['1h'].sendHidden, back.perTf['4h'].sendHidden]).toEqual([true, false, false]);
  });
  it('a comma decimal is a decimal; an empty field is not zero; out of range is refused by the contract', () => {
    const f = paramsToForm(OI_DIVERGENCE_DEFAULT_PARAMS);
    expect(formToParams({ ...f, atrMult: '0,3' })?.atrMult).toBe(0.3);
    expect(formToParams({ ...f, atrMult: '' })).toBeNull();
    expect(formToParams({ ...f, priceLineTolAtrMult: '0' })?.priceLineTolAtrMult).toBe(0); // 0 is the round-1 rule, not empty
    expect(formToParams({ ...f, oiLineTolMedianMult: '0,75' })?.oiLineTolMedianMult).toBe(0.75);
    expect(formToParams({ ...f, priceLineTolAtrMult: '' })).toBeNull();
    expect(formToParams({ ...f, oiLineTolMedianMult: '5.5' })).toBeNull(); // V18: max 5
    expect(formToParams({ ...f, perTf: { ...f.perTf, '4h': { ...f.perTf['4h'], nLeft: '0' } } })).toBeNull();
    expect(formToParams({ ...f, perTf: { ...f.perTf, '4h': { ...f.perTf['4h'], nRight: '51' } } })).toBeNull();
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
      .toEqual({ at: local('2026-11-04 12:06'), symbol: 'TRXUSDT', tf: '15m', bar: local('2026-11-04 12:00'), hole: `${local('2026-11-04 11:06')} – ${local('2026-11-04 11:11')}` });
  });
});
