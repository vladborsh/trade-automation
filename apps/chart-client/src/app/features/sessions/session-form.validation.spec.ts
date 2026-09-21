import type { InstrumentId } from '@trade-automation/contracts';
import { commonCoverage, defaultPeriod, hasErrors, periodFits, sessionCurrencies, toCreateRequest, validateSessionForm, type SessionFormFields } from './session-form.validation';
import { buildSessionLayout } from './session-layout';
import { CATALOGUE, DAY, T0 } from './sessions-test-fixtures';

const MIN = 60_000;

function fields(over: Partial<SessionFormFields> = {}): SessionFormFields {
  return {
    name: 'Practice',
    instruments: ['binance:BTCUSDT'],
    timeframe: '15m',
    periodFromMs: T0 + 10 * DAY,
    periodToMs: T0 + 20 * DAY,
    initialBalance: 10_000,
    defaultRiskPct: 1,
    costsEnabled: true,
    commissionPct: 0.04,
    spread: 0.5,
    skipWeekends: true,
    notionalWarnMultiple: 5,
    ...over,
  };
}

describe('validateSessionForm (mirrors the server session-validation.ts)', () => {
  it('accepts a complete form', () => {
    expect(validateSessionForm(fields(), CATALOGUE)).toEqual({});
  });

  it('instruments: at least one, at most 4, each with stored 1m', () => {
    expect(validateSessionForm(fields({ instruments: [] }), CATALOGUE).instruments).toMatch(/at least one/);
    const five = ['binance:BTCUSDT', 'binance:ETHUSDT', 'binance:A', 'binance:B', 'binance:C'] as InstrumentId[];
    expect(validateSessionForm(fields({ instruments: five }), CATALOGUE).instruments).toMatch(/at most 4/);
    expect(validateSessionForm(fields({ instruments: ['capitalcom:US100'] }), CATALOGUE).instruments).toMatch(/US100 has no stored 1m/);
  });

  it('rejects a mixed-currency selection (USD + CHF), with no fallback', () => {
    const errors = validateSessionForm(fields({ instruments: ['binance:BTCUSDT', 'capitalcom:EURCHF'] }), CATALOGUE);
    expect(errors.instruments).toMatch(/one session currency; these mix USD and CHF/);
    expect(hasErrors(errors)).toBe(true);
    expect(sessionCurrencies(['binance:BTCUSDT', 'binance:ETHUSDT'], CATALOGUE)).toEqual(['USD']);
  });

  it('period: both ends, from before to', () => {
    expect(validateSessionForm(fields({ periodFromMs: null }), CATALOGUE).periodFromMs).toMatch(/start and the end/);
    expect(validateSessionForm(fields({ periodToMs: T0 + 10 * DAY }), CATALOGUE).periodFromMs).toMatch(/start before it ends/);
  });

  it('period: must overlap each instrument’s [from, to + 1m) (server parity), naming it', () => {
    const errors = validateSessionForm(fields({ instruments: ['binance:BTCUSDT', 'binance:ETHUSDT'], periodFromMs: T0, periodToMs: T0 + 50 * DAY }), CATALOGUE);
    expect(errors.periodFromMs).toBe('The period does not overlap the stored 1m history of binance:ETHUSDT.');
    // the last stored 1m bar covers [to, to + 1m): a period starting inside it overlaps
    const lastBar = T0 + 300 * DAY;
    expect(validateSessionForm(fields({ periodFromMs: lastBar + MIN - 1, periodToMs: lastBar + DAY }), CATALOGUE).periodFromMs).not.toMatch(/does not overlap/);
    expect(validateSessionForm(fields({ periodFromMs: lastBar + MIN, periodToMs: lastBar + DAY }), CATALOGUE).periodFromMs).toMatch(/does not overlap/);
  });

  it('period: kept inside the common coverage of the chosen instruments', () => {
    const both: InstrumentId[] = ['binance:BTCUSDT', 'binance:ETHUSDT'];
    expect(commonCoverage(both, CATALOGUE)).toEqual({ from: T0 + 100 * DAY, to: T0 + 300 * DAY + MIN });
    expect(validateSessionForm(fields({ instruments: both, periodFromMs: T0 + 90 * DAY, periodToMs: T0 + 150 * DAY }), CATALOGUE).periodFromMs).toMatch(/inside the history all chosen instruments share/);
    expect(validateSessionForm(fields({ instruments: both, periodFromMs: T0 + 100 * DAY, periodToMs: T0 + 300 * DAY + MIN }), CATALOGUE)).toEqual({});
    expect(commonCoverage([], CATALOGUE)).toBeNull();
    expect(commonCoverage(['capitalcom:US100'], CATALOGUE)).toBeNull();
  });

  it('numbers: balance, risk and warning multiple above 0; costs 0 or more, checked only when enabled', () => {
    const errors = validateSessionForm(fields({ initialBalance: 0, defaultRiskPct: null, notionalWarnMultiple: -1, commissionPct: -0.1, spread: Number.NaN }), CATALOGUE);
    expect(Object.keys(errors).sort()).toEqual(['commissionPct', 'defaultRiskPct', 'initialBalance', 'notionalWarnMultiple', 'spread']);
    expect(validateSessionForm(fields({ costsEnabled: false, commissionPct: null, spread: null }), CATALOGUE)).toEqual({});
  });

  it('a blank name is refused', () => {
    expect(validateSessionForm(fields({ name: '   ' }), CATALOGUE).name).toMatch(/name/);
  });
});

describe('toCreateRequest', () => {
  it('builds the POST body; disabled costs are sent as zeros', () => {
    const f = fields({ name: '  BTC  ', costsEnabled: false, commissionPct: null, spread: null, skipWeekends: false });
    const layout = buildSessionLayout(f.instruments, null);
    expect(toCreateRequest(f, layout)).toEqual({
      name: 'BTC',
      layout,
      timeframe: '15m',
      periodFromMs: T0 + 10 * DAY,
      periodToMs: T0 + 20 * DAY,
      initialBalance: 10_000,
      defaultRiskPct: 1,
      costs: { enabled: false, commissionPct: 0, spread: 0 },
      skipWeekends: false,
      notionalWarnMultiple: 5,
    });
  });
});

describe('defaultPeriod / periodFits', () => {
  it('defaults to the last 30 days of the common coverage, or all of it when shorter', () => {
    expect(defaultPeriod({ from: T0, to: T0 + 300 * DAY + MIN })).toEqual({ from: T0 + 270 * DAY + MIN, to: T0 + 300 * DAY + MIN });
    expect(defaultPeriod({ from: T0 + 5 * DAY, to: T0 + 10 * DAY })).toEqual({ from: T0 + 5 * DAY, to: T0 + 10 * DAY });
  });

  it('rounds inward to whole minutes (datetime-local precision)', () => {
    const p = defaultPeriod({ from: T0 + 30_000, to: T0 + 5 * MIN + 30_000 });
    expect(p).toEqual({ from: T0 + MIN, to: T0 + 5 * MIN });
  });

  it('periodFits: set, ordered and inside the common coverage', () => {
    const common = { from: T0, to: T0 + 10 * DAY };
    expect(periodFits(T0, T0 + DAY, common)).toBe(true);
    expect(periodFits(T0 - 1, T0 + DAY, common)).toBe(false);
    expect(periodFits(null, T0 + DAY, common)).toBe(false);
    expect(periodFits(T0, T0 + DAY, null)).toBe(false);
  });
});
