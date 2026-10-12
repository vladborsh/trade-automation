import type { WebFeatureValue } from '@trade-automation/contracts';
import { labelFeatures, p4Label, priceDirection, type LabelInput } from '../../src/features/calculators/label-p4';

const val = (v: WebFeatureValue | undefined) => (v?.ok === true ? v.value : undefined);
const why = (v: WebFeatureValue | undefined) => (v?.ok === false ? v.why : undefined);
const input = (over: Partial<LabelInput> = {}): LabelInput =>
  ({ ret4hPct: 2, atr4h: 4, close: 100, cvdSpot4h: 50, cvdPerp4h: 50, ...over });

describe('priceDirection', () => {
  it('is flat unless the move is at least a quarter of an ATR', () => {
    // threshold = 0.25 * 4 / 100 = 1 %
    expect(priceDirection(2, 4, 100)).toBe('up');
    expect(priceDirection(0.5, 4, 100)).toBe('flat');
    expect(priceDirection(-2, 4, 100)).toBe('down');
    expect(priceDirection(1, 4, 100)).toBe('up'); // inclusive at the threshold
  });
});

describe('p4Label — §9.2 table, row by row', () => {
  it('up + spot up is SPOT_LED whatever perp does', () => {
    expect(p4Label('up', 'up', 'down')).toBe('SPOT_LED');
    expect(p4Label('up', 'up', 'up')).toBe('SPOT_LED');
  });
  it('up + spot not-up + perp up is PERP_LED', () => {
    expect(p4Label('up', 'down', 'up')).toBe('PERP_LED');
    expect(p4Label('up', 'flat', 'up')).toBe('PERP_LED');
  });
  it('down + spot up + perp down is ABSORPTION', () => {
    expect(p4Label('down', 'up', 'down')).toBe('ABSORPTION');
  });
  it('flat + spot down + perp up is DISTRIBUTION', () => {
    expect(p4Label('flat', 'down', 'up')).toBe('DISTRIBUTION');
  });
  it('everything else is NONE', () => {
    expect(p4Label('down', 'down', 'down')).toBe('NONE');
    expect(p4Label('flat', 'flat', 'flat')).toBe('NONE');
  });
});

describe('labelFeatures', () => {
  it('labels a classifiable frame', () => {
    expect(val(labelFeatures(input())['label.p4'])).toBe('SPOT_LED');
  });

  it('NONE IS A LABEL, NOT A FALLBACK FOR MISSING INPUT', () => {
    // A symbol with no spot market cannot be classified by a table whose first two rows read the
    // spot column; answering NONE would say "we looked and saw nothing" about a market we never
    // had. The dead-but-logged label (§16.3) still must not invent a reading.
    expect(why(labelFeatures(input({ cvdSpot4h: null }))['label.p4'])).toBe('not_applicable');
    expect(why(labelFeatures(input({ atr4h: null }))['label.p4'])).toBe('not_applicable');
  });
});
