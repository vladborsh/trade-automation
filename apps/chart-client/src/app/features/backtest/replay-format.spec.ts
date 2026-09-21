import { formatBalance, formatCursorUtc } from './replay-format';

describe('formatCursorUtc', () => {
  it('shows the cursor in UTC to the minute, whatever the local zone', () => {
    expect(formatCursorUtc(Date.UTC(2026, 8, 18, 23, 45))).toBe('2026-09-18 23:45 UTC');
    expect(formatCursorUtc(Date.UTC(2026, 8, 21, 0, 5, 30))).toBe('2026-09-21 00:05 UTC');
  });
});

describe('formatBalance', () => {
  it('two decimals, thousands separated, with the session currency', () => {
    expect(formatBalance(10000, 'USD')).toBe('10,000.00 USD');
    expect(formatBalance(-12.5, 'CHF')).toBe('-12.50 CHF');
  });
});
