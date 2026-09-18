import { formatCompact } from './compact-number.format';

describe('formatCompact (architecture/chart-layouts.md §11.2)', () => {
  it('prints USD notionals with a suffix and four significant digits', () => {
    expect(formatCompact(8_334_000_000)).toBe('8.334B');
    expect(formatCompact(12_345_678_901)).toBe('12.35B');
    expect(formatCompact(512_400_000)).toBe('512.4M');
    expect(formatCompact(1_500)).toBe('1.500K');
    expect(formatCompact(2_000_000_000_000)).toBe('2.000T');
  });

  it('moves to the next suffix instead of printing 1000 of the smaller one', () => {
    expect(formatCompact(999_990)).toBe('1.000M');
    expect(formatCompact(999_900)).toBe('999.9K');
  });

  it('prints small values plainly and non-finite values as empty', () => {
    expect(formatCompact(42)).toBe('42.00');
    expect(formatCompact(Number.NaN)).toBe('');
  });
});
