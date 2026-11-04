import { WEB_INSIGHT_KEYS, WEB_INSIGHT_RULES, WebFlowsResponseSchema } from '../src/insight';

/** IB-091 — «Деривативы и потоки» (phase 2, cut 2026-11-03). */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const example = require('./fixtures/flows.24h.json');

describe('IB-091 flows contract', () => {
  it('the example clients build against parses (built from one probe of each real source)', () => {
    const r = WebFlowsResponseSchema.parse(example);
    expect(r.dvol.series.length).toBeGreaterThan(20);
    expect(r.putCall.series).toHaveLength(72);
    expect(r.stablecoins.changeDays).toBe(1);
    expect(r.coinbasePremium.minutes).toBe(60);
  });

  it('a tile with no figure must say why, and a tile with one must not', () => {
    const noDvol = { ...example, dvol: { ...example.dvol, value: null, change: null } };
    expect(WebFlowsResponseSchema.safeParse(noDvol).success).toBe(false);
    expect(WebFlowsResponseSchema.safeParse({ ...noDvol, dvol: { ...noDvol.dvol, unavailable: 'source_unavailable' } }).success).toBe(true);
    const saysWhyButHasIt = { ...example, coinbasePremium: { ...example.coinbasePremium, unavailable: 'source_unavailable' } };
    expect(WebFlowsResponseSchema.safeParse(saysWhyButHasIt).success).toBe(false);
  });

  it('D18: the premium may show its value WITH insufficient_minutes; no other tile may use that reason', () => {
    const thin = { ...example, coinbasePremium: { ...example.coinbasePremium, unavailable: 'insufficient_minutes', sameSignMinutes: 30, minutes: 44 } };
    expect(WebFlowsResponseSchema.safeParse(thin).success).toBe(true);
    const nullNoReason = { ...example, coinbasePremium: { ...example.coinbasePremium, premiumPct: null } };
    expect(WebFlowsResponseSchema.safeParse(nullNoReason).success).toBe(false);
    expect(WebFlowsResponseSchema.safeParse({ ...example, dvol: { ...example.dvol, value: null, change: null, unavailable: 'insufficient_minutes' } }).success).toBe(false);
  });

  it('phase 2 adds R8–R10 and their three sentence keys (put/call has no rule — the cut)', () => {
    expect(WEB_INSIGHT_RULES).toEqual(expect.arrayContaining(['R8', 'R9', 'R10']));
    expect(WEB_INSIGHT_KEYS).toEqual(expect.arrayContaining(['insight.dvol_spike', 'insight.stablecoin_supply', 'insight.coinbase_premium']));
    expect(WEB_INSIGHT_KEYS.some((k) => /put|call/i.test(k))).toBe(false);
  });
});
