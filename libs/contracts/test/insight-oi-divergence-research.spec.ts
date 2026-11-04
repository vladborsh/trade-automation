import {
  OI_FAV_ATR_MULTS, OI_NEAR_MISS_RULES, OI_NEAR_MISS_UNIT, OI_RANDOM_CONTROLS_PER_DAY, OI_RESEARCH_WINDOW_SEC, OI_RESEARCH_WINDOWS,
  OiBuildSchema,
} from '../src/insight';

/** IB-115 — the research journal's vocabulary (design V23–V27). */
describe('OI divergence research contracts (IB-115)', () => {
  it('V24: windows 4h / 24h / 72h, thresholds 0.5 / 1 / 2 × ATR14', () => {
    expect(OI_RESEARCH_WINDOWS.map((w) => OI_RESEARCH_WINDOW_SEC[w])).toEqual([4 * 3_600, 24 * 3_600, 72 * 3_600]);
    expect([...OI_FAV_ATR_MULTS]).toEqual([0.5, 1, 2]);
  });

  it('V25: 2 random controls per coin, TF and day', () => {
    expect(OI_RANDOM_CONTROLS_PER_DAY).toBe(2);
  });

  it('V26: six rules, each with its unit', () => {
    expect(OI_NEAR_MISS_RULES.map((r) => `${r}:${OI_NEAR_MISS_UNIT[r]}`)).toEqual([
      'price_delta:threshold', 'oi_delta:threshold', 'price_line:atr14', 'oi_line:oi_median', 'k:bars', 'w:bars',
    ]);
  });

  it('V27: a build is 12 hex characters of a commit, «dev» or «pre-027» — nothing else', () => {
    for (const ok of ['b49cd48d4ab4', 'dev', 'pre-027']) expect(OiBuildSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['', 'b49cd48d4ab', 'b49cd48d4ab4a', 'B49CD48D4AB4', 'sha-b49cd48d4ab4', 'unknown']) {
      expect(OiBuildSchema.safeParse(bad).success).toBe(false);
    }
  });
});
