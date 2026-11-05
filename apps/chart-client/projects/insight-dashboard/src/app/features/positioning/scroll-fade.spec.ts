import { describe, expect, it } from 'vitest';
import { hasMoreRight, SUBPIXEL_SLACK } from './scroll-fade';

/** IB-BUG-041: the right-edge fade shows only while the box hides columns to the right. */
describe('hasMoreRight', () => {
  // the phone at 390: a 324 px box over an 898 px table (live, 2026-11-05)
  const phone = { clientWidth: 324, scrollWidth: 898 };

  it('a table wider than its box, not scrolled: more to the right', () => {
    expect(hasMoreRight({ ...phone, scrollLeft: 0 })).toBe(true);
  });

  it('part-way across: still more', () => {
    expect(hasMoreRight({ ...phone, scrollLeft: 300 })).toBe(true);
  });

  it('scrolled to the far right: nothing more', () => {
    expect(hasMoreRight({ ...phone, scrollLeft: 898 - 324 })).toBe(false);
  });

  it('a fraction short of the far right (fractional DPR) counts as the far right', () => {
    expect(hasMoreRight({ ...phone, scrollLeft: 898 - 324 - 0.5 })).toBe(false);
    expect(hasMoreRight({ ...phone, scrollLeft: 898 - 324 - SUBPIXEL_SLACK })).toBe(false);
  });

  it('one real pixel past the slack is still more', () => {
    expect(hasMoreRight({ ...phone, scrollLeft: 898 - 324 - SUBPIXEL_SLACK - 1 })).toBe(true);
  });

  it('a table that fits its box (desktop): no fade', () => {
    expect(hasMoreRight({ scrollLeft: 0, clientWidth: 1158, scrollWidth: 1158 })).toBe(false);
  });
});
