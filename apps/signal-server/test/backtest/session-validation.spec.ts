import { Coverage, CreateSessionRequest, InstrumentId } from '@trade-automation/contracts';
import {
  checkLayoutPanels,
  panelsLosingActiveOrders,
  periodShapeError,
  validateCreateSession,
  validateLayoutEdit,
} from '../../src/backtest/session-validation';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

function panel(id: string, instrument: string, kind = 'candles') {
  return { id, kind, instrument, signals: false };
}

function req(instruments: InstrumentId[], from = T0 + 10 * DAY, to = T0 + 20 * DAY): Pick<CreateSessionRequest, 'layout' | 'periodFromMs' | 'periodToMs'> {
  return {
    layout: {
      id: 'l',
      name: 'L',
      grid: { columns: 2, rows: 2 },
      panels: instruments.map((inst, i) => panel(`p${i}`, inst)) as CreateSessionRequest['layout']['panels'],
    },
    periodFromMs: from,
    periodToMs: to,
  };
}

const currencies = new Map<InstrumentId, string>([
  ['binance:BTCUSDT', 'USD'],
  ['binance:ETHUSDT', 'USD'],
  ['capitalcom:EURCHF', 'CHF'],
  ['capitalcom:US100', 'USD'],
]);
const coverage = new Map<InstrumentId, Coverage | null>([
  ['binance:BTCUSDT', { from: T0, to: T0 + 30 * DAY }],
  ['binance:ETHUSDT', { from: T0, to: T0 + 30 * DAY }],
  ['capitalcom:EURCHF', { from: T0, to: T0 + 30 * DAY }],
  ['capitalcom:US100', null],
]);

describe('session-validation (backtest-app-system-design.md §7.2)', () => {
  describe('checkLayoutPanels — runs on the raw body, before the contract schema', () => {
    it('LAYOUT_TOO_MANY_PANELS above 4 panels', () => {
      const body = { layout: { panels: [1, 2, 3, 4, 5].map((i) => panel(`p${i}`, 'binance:BTCUSDT')) } };
      expect(checkLayoutPanels(body)).toMatchObject({ code: 'LAYOUT_TOO_MANY_PANELS' });
    });

    it('LAYOUT_NOT_CANDLES for a metric panel', () => {
      const body = { layout: { panels: [panel('a', 'binance:BTCUSDT'), panel('oi', 'binance:BTCUSDT', 'metric')] } };
      expect(checkLayoutPanels(body)).toMatchObject({ code: 'LAYOUT_NOT_CANDLES', message: expect.stringContaining("'oi'") });
    });

    it('passes 1..4 candle panels, and leaves non-array shapes to the schema', () => {
      expect(checkLayoutPanels({ layout: { panels: [1, 2, 3, 4].map((i) => panel(`p${i}`, 'x')) } })).toBeNull();
      expect(checkLayoutPanels({})).toBeNull();
      expect(checkLayoutPanels(null)).toBeNull();
      expect(checkLayoutPanels({ layout: { panels: 'nope' } })).toBeNull();
    });
  });

  it('period sanity: from must be before to', () => {
    expect(periodShapeError({ periodFromMs: 1, periodToMs: 2 })).toBeNull();
    expect(periodShapeError({ periodFromMs: 2, periodToMs: 2 })).toMatch(/before/);
    expect(periodShapeError({ periodFromMs: 3, periodToMs: 2 })).toMatch(/before/);
  });

  describe('validateCreateSession', () => {
    it('accepts panels sharing one sessionCurrency and returns it', () => {
      expect(validateCreateSession(req(['binance:BTCUSDT', 'binance:ETHUSDT', 'binance:BTCUSDT']), currencies, coverage)).toEqual({
        sessionCurrency: 'USD',
      });
      expect(validateCreateSession(req(['capitalcom:EURCHF']), currencies, coverage)).toEqual({ sessionCurrency: 'CHF' });
    });

    it('INSTRUMENT_NOT_AVAILABLE for an unconfigured instrument or one with no stored 1m', () => {
      expect(validateCreateSession(req(['binance:SOLUSDT']), currencies, coverage)).toMatchObject({ code: 'INSTRUMENT_NOT_AVAILABLE' });
      expect(validateCreateSession(req(['capitalcom:US100']), currencies, coverage)).toMatchObject({
        code: 'INSTRUMENT_NOT_AVAILABLE',
        message: expect.stringContaining('capitalcom:US100'),
      });
    });

    it('MIXED_SESSION_CURRENCY when panels span USD and CHF', () => {
      expect(validateCreateSession(req(['binance:BTCUSDT', 'capitalcom:EURCHF']), currencies, coverage)).toMatchObject({
        code: 'MIXED_SESSION_CURRENCY',
        message: expect.stringContaining('USD, CHF'),
      });
    });

    it('PERIOD_OUTSIDE_COVERAGE when the period misses any panel’s 1m coverage', () => {
      const partial = new Map(coverage).set('binance:ETHUSDT', { from: T0 + 25 * DAY, to: T0 + 30 * DAY });
      expect(validateCreateSession(req(['binance:BTCUSDT', 'binance:ETHUSDT']), currencies, partial)).toMatchObject({
        code: 'PERIOD_OUTSIDE_COVERAGE',
        message: expect.stringContaining('binance:ETHUSDT'),
      });
      expect(validateCreateSession(req(['binance:BTCUSDT'], T0 - 5 * DAY, T0), currencies, coverage)).toMatchObject({
        code: 'PERIOD_OUTSIDE_COVERAGE',
      });
    });

    it('intersection, not containment; the last stored 1m bar covers [to, to + 1m)', () => {
      const cov = coverage.get('binance:BTCUSDT')!;
      // overlaps only the head / only the tail: accepted
      expect(validateCreateSession(req(['binance:BTCUSDT'], T0 - 5 * DAY, T0 + 1), currencies, coverage)).toEqual({ sessionCurrency: 'USD' });
      expect(validateCreateSession(req(['binance:BTCUSDT'], cov.to + 59_999, cov.to + DAY), currencies, coverage)).toEqual({
        sessionCurrency: 'USD',
      });
      // starts exactly when the last bar closes: nothing to replay
      expect(validateCreateSession(req(['binance:BTCUSDT'], cov.to + 60_000, cov.to + DAY), currencies, coverage)).toMatchObject({
        code: 'PERIOD_OUTSIDE_COVERAGE',
      });
    });

    it('checks availability before currency, and currency before coverage', () => {
      const none = new Map(coverage).set('binance:ETHUSDT', null);
      expect(validateCreateSession(req(['binance:ETHUSDT', 'capitalcom:EURCHF']), currencies, none)).toMatchObject({
        code: 'INSTRUMENT_NOT_AVAILABLE',
      });
      expect(validateCreateSession(req(['binance:BTCUSDT', 'capitalcom:EURCHF'], T0 - 5 * DAY, T0 - DAY), currencies, coverage)).toMatchObject({
        code: 'MIXED_SESSION_CURRENCY',
      });
    });
  });
});

describe('T-029 layout edit rules', () => {
  const session = { sessionCurrency: 'USD', periodFromMs: T0 + 10 * DAY, periodToMs: T0 + 20 * DAY };

  it('validateLayoutEdit: the create checks against the session period', () => {
    expect(validateLayoutEdit(req(['binance:BTCUSDT', 'binance:ETHUSDT']).layout, session, currencies, coverage)).toBeNull();
    expect(validateLayoutEdit(req(['capitalcom:US100']).layout, session, currencies, coverage)).toMatchObject({ code: 'INSTRUMENT_NOT_AVAILABLE' });
    const late = new Map(coverage).set('binance:ETHUSDT', { from: T0 + 25 * DAY, to: T0 + 30 * DAY });
    expect(validateLayoutEdit(req(['binance:ETHUSDT']).layout, session, currencies, late)).toMatchObject({ code: 'PERIOD_OUTSIDE_COVERAGE' });
  });

  it('validateLayoutEdit: may not change the session currency, even with a consistent layout', () => {
    expect(validateLayoutEdit(req(['capitalcom:EURCHF']).layout, session, currencies, coverage)).toMatchObject({
      code: 'MIXED_SESSION_CURRENCY',
      message: expect.stringMatching(/trades in USD; its panels cannot move to CHF/),
    });
    expect(validateLayoutEdit(req(['binance:BTCUSDT', 'capitalcom:EURCHF']).layout, session, currencies, coverage)).toMatchObject({
      code: 'MIXED_SESSION_CURRENCY',
    });
  });

  it('panelsLosingActiveOrders: removed panels, and panels re-pointed at another instrument', () => {
    const next = req(['binance:BTCUSDT', 'binance:ETHUSDT']).layout; // p0 = BTC, p1 = ETH
    expect(panelsLosingActiveOrders(next, [])).toEqual([]);
    expect(panelsLosingActiveOrders(next, [{ panelId: 'p0', instrument: 'binance:BTCUSDT' }])).toEqual([]);
    expect(panelsLosingActiveOrders(next, [{ panelId: 'gone', instrument: 'binance:BTCUSDT' }, { panelId: 'gone', instrument: 'binance:BTCUSDT' }])).toEqual(['gone']);
    expect(panelsLosingActiveOrders(next, [{ panelId: 'p1', instrument: 'binance:BTCUSDT' }])).toEqual(['p1']); // same id, other instrument
  });
});
