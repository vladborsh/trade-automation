import { describe, expect, it } from 'vitest';
import { FLAG_SVG, flagFor } from './calendar-flags';

/** IB-099 item 1 — flags are SVG (Windows draws flag emoji as letters), keyed by the feed's currency. */
describe('calendar flags', () => {
  it('USD — the one the chart marks today — has a flag; the map is open for the majors', () => {
    expect(flagFor('USD')).toBe(FLAG_SVG['USD']);
    for (const c of ['EUR', 'GBP', 'JPY', 'CHF', 'CAD']) expect(flagFor(c), c).not.toBeNull();
    expect(flagFor('usd')).toBe(FLAG_SVG['USD']);
  });
  it('every flag is an inline SVG drawn inside a circle, no emoji, no external file', () => {
    for (const [code, svg] of Object.entries(FLAG_SVG)) {
      expect(svg.startsWith('<svg'), code).toBe(true);
      expect(svg).toContain('clip-path');
      expect(svg).not.toMatch(/https?:|\p{Extended_Pictographic}|\p{Regional_Indicator}/u);
    }
  });
  it('an unmapped currency has no flag (the badge shows the code instead)', () => {
    expect([flagFor('XYZ'), flagFor(null), flagFor('')]).toEqual([null, null, null]);
  });
});
