import {
  formatMoney,
  formatPercent,
  formatPrice,
  formatR,
  formatRAmount,
  formatRatio,
  formatSignedMoney,
  formatUtc,
  orderFlags,
} from './journal-format';

describe('journal formatting (display only)', () => {
  it('signs money and R with a true minus', () => {
    expect(formatSignedMoney(1234.5, 'USD')).toBe('+1,234.50 USD');
    expect(formatSignedMoney(-3.2, 'CHF')).toBe('−3.20 CHF');
    expect(formatSignedMoney(0, 'USD')).toBe('0.00 USD');
    expect(formatR(1.5)).toBe('+1.50 R');
    expect(formatR(-0.987)).toBe('−0.99 R');
  });

  it('shows unsigned amounts, percents, prices and ratios', () => {
    expect(formatMoney(4.1, 'USD')).toBe('4.10 USD');
    expect(formatRAmount(2.4)).toBe('2.40 R');
    expect(formatPercent(12.345)).toBe('12.3 %');
    expect(formatPrice(76_829.9, 2)).toBe('76829.90');
    expect(formatPrice(1.2345678, 5)).toBe('1.23457');
    expect(formatPrice(3, undefined)).toBe('3.00');
    expect(formatRatio(1.8512)).toBe('1.85');
  });

  it('shows what is missing as a dash, and a profit factor without losses as n/a', () => {
    for (const s of [formatSignedMoney(null, 'USD'), formatMoney(null, 'USD'), formatR(null), formatRAmount(null), formatPercent(null), formatPrice(null, 2), formatUtc(null)]) {
      expect(s).toBe('—');
    }
    expect(formatRatio(null)).toBe('n/a');
  });

  it('formats replay time in UTC to the minute', () => {
    expect(formatUtc(Date.UTC(2026, 8, 16, 10, 5, 42))).toBe('2026-09-16 10:05');
  });
});

describe('orderFlags', () => {
  const none = { fillResolution: '1m' as const, closeReason: 'take-profit' as const, slTpSameBar: false };

  it('has no badge for an ordinary 1m trade', () => {
    expect(orderFlags(none)).toEqual([]);
  });

  it('explains every flag', () => {
    const flags = orderFlags({ fillResolution: 'pessimistic-bar', closeReason: 'end-of-session', slTpSameBar: true });
    expect(flags.map((f) => f.key)).toEqual(['pessimistic-bar', 'sl-tp-same-bar', 'end-of-session']);
    expect(flags[0].title).toBe('Resolved on bars, not 1m: stop assumed first');
    expect(flags[1].title).toBe('SL and TP in one candle — stop taken');
    expect(flags[2].title).toMatch(/end of the session/);
  });
});
