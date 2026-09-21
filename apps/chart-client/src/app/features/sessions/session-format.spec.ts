import { formatMoney, formatPeriod, formatPnl, formatR, fromUtcInputValue, layoutInstruments, toUtcInputValue } from './session-format';

const T = Date.UTC(2021, 5, 1, 12, 30);

describe('session-format', () => {
  it('formats periods in UTC to the minute', () => {
    expect(formatPeriod(T, Date.UTC(2021, 6, 1))).toBe('2021-06-01 12:30 → 2021-07-01 00:00 UTC');
  });

  it('formats money, PnL and R with explicit signs', () => {
    expect(formatMoney(10250.5, 'USD')).toBe('10,250.50 USD');
    expect(formatPnl(150.254, 'USD')).toBe('+150.25 USD');
    expect(formatPnl(-20, 'CHF')).toBe('−20.00 CHF');
    expect(formatPnl(0.001, 'USD')).toBe('0.00 USD');
    expect(formatR(1.5)).toBe('+1.50 R');
    expect(formatR(-0.754)).toBe('−0.75 R');
    expect(formatR(-0.001)).toBe('0.00 R');
  });

  it('lists a layout’s instrument symbols once each', () => {
    const layout = {
      id: 'l',
      name: 'L',
      grid: { columns: 3, rows: 1 },
      panels: [
        { id: 'a', kind: 'candles' as const, instrument: 'binance:BTCUSDT' as const, signals: false },
        { id: 'b', kind: 'candles' as const, instrument: 'binance:BTCUSDT' as const, signals: false },
        { id: 'c', kind: 'candles' as const, instrument: 'binance:ETHUSDT' as const, signals: false },
      ],
    };
    expect(layoutInstruments(layout)).toBe('BTCUSDT, ETHUSDT');
  });

  it('round-trips datetime-local values as UTC, rejecting malformed input', () => {
    expect(toUtcInputValue(T)).toBe('2021-06-01T12:30');
    expect(fromUtcInputValue('2021-06-01T12:30')).toBe(T);
    expect(toUtcInputValue(null)).toBe('');
    expect(fromUtcInputValue('')).toBeNull();
    expect(fromUtcInputValue('2021-13-45T99:99')).toBeNull();
    expect(fromUtcInputValue('2021-06-01')).toBeNull();
  });
});
