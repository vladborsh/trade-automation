import type { Order, OrderModification } from '@trade-automation/contracts';
import { modificationText, tradeDetailFields } from './trade-detail-fields';

const T = Date.UTC(2026, 8, 16, 10, 4);
const ORDER = {
  id: 'o1', seq: 2, instrument: 'binance:BTCUSDT', side: 'short', type: 'limit', status: 'closed', placedAtMs: T - 600_000,
  limitPrice: 100.5, slInitial: 105, slCurrent: 104, tpInitial: 90, tpCurrent: 90, entryPrice: 100.5, entryTimeMs: T,
  exitPrice: 104, exitTimeMs: T + 3_600_000, closeReason: 'stop', qty: 2, riskPct: 1, riskAmountCcy: 100, commissionCcy: 0.8,
  spreadCostCcy: 0.1, pnlCcy: -7.9, pnlR: -0.079, maePrice: 3.5, maeR: 0.07, fillResolution: 'pessimistic-bar', slTpSameBar: true,
} as unknown as Order;

describe('tradeDetailFields (§9.3)', () => {
  const byField = Object.fromEntries(tradeDetailFields(ORDER, 'USD', 1).map((f) => [f.field, f]));

  it('shows levels, fills, costs split, P&L and MAE from the server row', () => {
    expect(byField['slInitial'].text).toBe('105.0');
    expect(byField['slCurrent'].text).toBe('104.0');
    expect(byField['entryTimeMs'].text).toBe('2026-09-16 10:04 UTC');
    expect(byField['commissionCcy'].text).toBe('0.80 USD');
    expect(byField['spreadCostCcy'].text).toBe('0.10 USD');
    expect(byField['pnlCcy'].text).toBe('−7.90 USD');
    expect(byField['maeR'].text).toBe('0.07 R');
    expect(byField['riskAmountCcy'].raw).toBe(100);
  });

  it('explains how it was resolved, flags included', () => {
    expect(byField['fillResolution'].text).toBe('bars · Resolved on bars, not 1m: stop assumed first · SL and TP in one candle — stop taken');
  });

  it('dashes what does not exist yet', () => {
    const pending = tradeDetailFields({ ...ORDER, status: 'pending', entryPrice: null, entryTimeMs: null, exitPrice: null, exitTimeMs: null, closeReason: null, pnlCcy: null, pnlR: null, maePrice: null, maeR: null, fillResolution: null }, 'USD', 1);
    expect(pending.filter((f) => f.text === '—').map((f) => f.field)).toEqual(['entryPrice', 'entryTimeMs', 'exitPrice', 'exitTimeMs', 'closeReason', 'pnlCcy', 'pnlR', 'maePrice', 'maeR', 'fillResolution']);
  });
});

describe('modificationText', () => {
  it('says when, which level and from → to', () => {
    const m = { id: 1, orderId: 'o1', cursorMs: T, field: 'sl', oldValue: 105, newValue: 104, createdAt: 0 } as OrderModification;
    expect(modificationText(m, 1)).toBe('2026-09-16 10:04 UTC — Stop 105.0 → 104.0');
  });
});
