import { fngBand } from '../../src/insights/sentiment';

/** Moved from the KPI rules spec by IB-117 (the F&G tile left; rule R7 still words the band). */
describe('fngBand', () => {
  it('F&G bands are the ones alternative.me uses', () => {
    expect([0, 24, 25, 44, 45, 55, 56, 75, 76, 100].map(fngBand)).toEqual([
      'extreme_fear', 'extreme_fear', 'fear', 'fear', 'neutral', 'neutral', 'greed', 'greed', 'extreme_greed', 'extreme_greed',
    ]);
  });
});
