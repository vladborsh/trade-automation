import {
  BACKTEST_BOUNDS,
  CreateSessionRequestSchema,
  ModifyOrderRequestSchema,
  PlaceOrderRequestSchema,
} from '../src';

/**
 * BUG-002 / BUG-003 (provisional bounds, pending Architect confirmation): every bounded request
 * field accepts its edge and rejects just past it, and the exact values from the bug reports are
 * rejected by the schema (a 400 from the server's ZodValidationPipe, never a pg overflow).
 */
const session = (over: Record<string, unknown> = {}) => ({
  name: 'Bounds',
  layout: {
    id: 'l',
    name: 'L',
    grid: { columns: 1, rows: 1 },
    panels: [{ id: 'p1', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }],
  },
  timeframe: '1m',
  periodFromMs: Date.UTC(2024, 2, 4),
  periodToMs: Date.UTC(2024, 2, 6),
  initialBalance: 10_000,
  defaultRiskPct: 1,
  costs: { enabled: true, commissionPct: 0.04, spread: 1 },
  ...over,
});
const order = (over: Record<string, unknown> = {}) => ({
  opId: '33333333-3333-4333-8333-333333333333',
  cursorMs: Date.UTC(2024, 2, 4, 11),
  panelId: 'p1',
  side: 'long',
  type: 'market',
  sl: 59_000,
  riskPct: 1,
  ...over,
});
const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) => schema.safeParse(v).success;

describe('BACKTEST_BOUNDS (BUG-002/BUG-003)', () => {
  it('exposes the column-derived numbers', () => {
    expect(BACKTEST_BOUNDS).toEqual({
      moneyMaxExclusive: 1e12,
      riskPctMin: 0.0001,
      riskPctMax: 100,
      commissionPctMax: 100,
      notionalWarnMultipleMax: 999_999.99,
    });
  });

  describe('CreateSessionRequest', () => {
    it('defaultRiskPct: 0.0001 … 100 accepted; below or above rejected', () => {
      expect(ok(CreateSessionRequestSchema, session({ defaultRiskPct: 0.0001 }))).toBe(true);
      expect(ok(CreateSessionRequestSchema, session({ defaultRiskPct: 100 }))).toBe(true);
      expect(ok(CreateSessionRequestSchema, session({ defaultRiskPct: 0.00009 }))).toBe(false);
      expect(ok(CreateSessionRequestSchema, session({ defaultRiskPct: 100.0001 }))).toBe(false);
    });

    it('initialBalance: > 0 and < 1e12', () => {
      expect(ok(CreateSessionRequestSchema, session({ initialBalance: 1e-9 }))).toBe(true);
      expect(ok(CreateSessionRequestSchema, session({ initialBalance: 999_999_999_999.99 }))).toBe(true);
      expect(ok(CreateSessionRequestSchema, session({ initialBalance: 1e12 }))).toBe(false);
      expect(ok(CreateSessionRequestSchema, session({ initialBalance: 0 }))).toBe(false);
    });

    it('costs.commissionPct: 0 … 100; costs.spread: 0 … < 1e12', () => {
      const costs = (c: object) => session({ costs: { enabled: true, commissionPct: 0, spread: 0, ...c } });
      expect(ok(CreateSessionRequestSchema, costs({ commissionPct: 100 }))).toBe(true);
      expect(ok(CreateSessionRequestSchema, costs({ commissionPct: 100.0001 }))).toBe(false);
      expect(ok(CreateSessionRequestSchema, costs({ spread: 999_999_999_999.99 }))).toBe(true);
      expect(ok(CreateSessionRequestSchema, costs({ spread: 1e12 }))).toBe(false);
    });

    it('notionalWarnMultiple: > 0 and <= 999 999.99', () => {
      expect(ok(CreateSessionRequestSchema, session({ notionalWarnMultiple: 999_999.99 }))).toBe(true);
      expect(ok(CreateSessionRequestSchema, session({ notionalWarnMultiple: 1_000_000 }))).toBe(false);
    });

    it('rejects every BUG-002 reproduction value', () => {
      for (const over of [
        { defaultRiskPct: 10_000 },
        { initialBalance: 1e13 },
        { costs: { enabled: true, commissionPct: 100_000, spread: 0 } },
        { costs: { enabled: true, commissionPct: 0, spread: 1e13 } },
        { notionalWarnMultiple: 1_000_000 },
      ]) {
        expect({ over, ok: ok(CreateSessionRequestSchema, session(over)) }).toEqual({ over, ok: false });
      }
      // the report's accepted values stay accepted
      expect(ok(CreateSessionRequestSchema, session({ defaultRiskPct: 100 }))).toBe(true);
      expect(ok(CreateSessionRequestSchema, session({ initialBalance: 1e-9 }))).toBe(true);
    });
  });

  describe('PlaceOrderRequest / ModifyOrderRequest', () => {
    it('riskPct: 0.0001 … 100; the BUG-003 values are rejected', () => {
      expect(ok(PlaceOrderRequestSchema, order({ riskPct: 0.0001 }))).toBe(true);
      expect(ok(PlaceOrderRequestSchema, order({ riskPct: 100 }))).toBe(true);
      for (const riskPct of [10_000, 1_000_000, 0.00001, 100.0001]) {
        expect({ riskPct, ok: ok(PlaceOrderRequestSchema, order({ riskPct })) }).toEqual({ riskPct, ok: false });
      }
    });

    it('limitPrice, sl, tp: > 0 and < 1e12', () => {
      expect(ok(PlaceOrderRequestSchema, order({ type: 'limit', limitPrice: 999_999_999_999.99, sl: 1, tp: 999_999_999_999.99 }))).toBe(true);
      expect(ok(PlaceOrderRequestSchema, order({ sl: 1e12 }))).toBe(false);
      expect(ok(PlaceOrderRequestSchema, order({ sl: 0 }))).toBe(false);
      expect(ok(PlaceOrderRequestSchema, order({ tp: 1e12 }))).toBe(false);
      expect(ok(PlaceOrderRequestSchema, order({ type: 'limit', limitPrice: 1e12 }))).toBe(false);
      expect(ok(PlaceOrderRequestSchema, order({ type: 'limit', limitPrice: -1 }))).toBe(false);
      const modify = { opId: '33333333-3333-4333-8333-333333333333', cursorMs: 1 };
      expect(ok(ModifyOrderRequestSchema, { ...modify, sl: 999_999_999_999.99 })).toBe(true);
      expect(ok(ModifyOrderRequestSchema, { ...modify, sl: 1e12 })).toBe(false);
      expect(ok(ModifyOrderRequestSchema, { ...modify, tp: 0 })).toBe(false);
    });
  });
});
