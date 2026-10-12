import type { WebFeatureValue } from '@trade-automation/contracts';
import { priceFeatures, type PriceInput } from '../../src/features/calculators/price';

const val = (v: WebFeatureValue | undefined) => (v?.ok === true ? v.value : undefined);
const why = (v: WebFeatureValue | undefined) => (v?.ok === false ? v.why : undefined);
const input = (over: Partial<PriceInput> = {}): PriceInput =>
  ({ close: 110, close24hAgo: 100, close4hAgo: 100, high24h: 120, barHigh: 112, barLow: 108, ...over });

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

/**
 * IB-018 — the frame bar's own high and low.
 *
 * The distinction these pin: `px.close` can be read off one bar on either timeframe, because a
 * 4h close IS its final 15m close. A 4h high is a reduction over sixteen bars. Same input
 * group, different derivation — and if someone simplifies the high to the last bar's high,
 * P3's stop (`cascade low − 0.1·ATR`) quietly moves.
 */
describe('px.high and px.low', () => {
  it('reports the frame bar extremes the caller reduced', () => {
    const out = priceFeatures(input({ barHigh: 125, barLow: 95 }));
    expect(out['px.high']).toEqual({ ok: true, value: 125 });
    expect(out['px.low']).toEqual({ ok: true, value: 95 });
  });

  it('is NOT the 24h high — they are different windows and both are keys', () => {
    const out = priceFeatures(input({ barHigh: 112, high24h: 120 }));
    expect(out['px.high']).toEqual({ ok: true, value: 112 });
  });

  it('refuses with no_data when the bar is absent, never with a history reason', () => {
    // If the frame bar has no high, the bar is not there. That is not a question about how much
    // history exists, and labelling it one would put it in the wrong counter.
    const out = priceFeatures(input({ barHigh: null, barLow: null }));
    expect(out['px.high']).toEqual({ ok: false, why: 'no_data' });
    expect(out['px.low']).toEqual({ ok: false, why: 'no_data' });
  });

  it('refuses each independently, rather than treating one absence as both', () => {
    const out = priceFeatures(input({ barHigh: 125, barLow: null }));
    expect(out['px.high']).toEqual({ ok: true, value: 125 });
    expect(out['px.low']).toEqual({ ok: false, why: 'no_data' });
  });

  it('does not refuse a legitimately zero or negative extreme', () => {
    // A price of 0 is nonsense for a close but these are reported, not divided by — refusing a
    // real stored extreme would be inventing a rule the key does not have.
    expect(priceFeatures(input({ barLow: 0 }))['px.low']).toEqual({ ok: true, value: 0 });
  });
});
