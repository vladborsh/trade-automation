import { describe, expect, it } from 'vitest';
import { AmountPipe, formatAmount } from './amount';

/** IB-BUG-024 (b) — the top-50 table's price and qty, from the values seen on the box. */
describe('formatAmount', () => {
  it('removes float noise and keeps every real digit', () => {
    expect(formatAmount(140.06500000000003)).toBe('140.065');
    expect(formatAmount(88.39500000000001)).toBe('88.395');
    expect(formatAmount(767.309)).toBe('767.309');
    expect(formatAmount(2278.85)).toBe('2278.85');
    expect(formatAmount(0.000012345)).toBe('0.000012345');
    expect(formatAmount(30)).toBe('30');
  });
  it('a missing number is a dash, not NaN', () => {
    expect(formatAmount(Number.NaN)).toBe('—');
    expect(formatAmount(null)).toBe('—');
  });
  it('the pipe is the function', () => {
    expect(new AmountPipe().transform(140.06500000000003)).toBe('140.065');
  });
});
