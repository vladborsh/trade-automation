import type { WebFeatureValue } from '@trade-automation/contracts';
import { priceFeatures, type PriceInput } from '../../src/features/calculators/price';

const val = (v: WebFeatureValue | undefined) => (v?.ok === true ? v.value : undefined);
const why = (v: WebFeatureValue | undefined) => (v?.ok === false ? v.why : undefined);
const input = (over: Partial<PriceInput> = {}): PriceInput =>
  ({ close: 110, close24hAgo: 100, close4hAgo: 100, high24h: 120, ...over });

describe('price context', () => {
  it('reports both returns and the drawdown as percentages', () => {
    const f = priceFeatures(input());
    expect(val(f['px.ret_24h'])).toBeCloseTo(10, 10);
    expect(val(f['px.drawdown_from_24h_high'])).toBeCloseTo(-8.3333, 3);
  });

  it('A DRAWDOWN OF ZERO AT THE HIGH IS A MEASUREMENT, not an absence', () => {
    expect(val(priceFeatures(input({ close: 120, high24h: 120 }))['px.drawdown_from_24h_high'])).toBe(0);
  });

  it('refuses a return whose reference bar is not stored', () => {
    expect(why(priceFeatures(input({ close4hAgo: null }))['px.ret_4h'])).toBe('no_data');
  });

  it('refuses rather than dividing by a zero reference', () => {
    expect(why(priceFeatures(input({ close24hAgo: 0 }))['px.ret_24h'])).toBe('insufficient_history');
  });
});
