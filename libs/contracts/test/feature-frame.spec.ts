import {
  WEB_FEATURE_KEYS, WEB_FEATURE_SPEC, WEB_FRAME_VERSION, WebFeatureFrameSchema,
  WebFeatureValueSchema, canArm, featureOr, featureSpecFingerprint, requireFeature,
} from '../src/insight/feature-frame';

/**
 * IB-015 — the frame contract. The key set is a contract, not an implementation detail, so the
 * things asserted here are the things a change must not do silently.
 */

describe('the key set is pinned', () => {
  it('HAS THIS FINGERPRINT, and changing a key or its meaning must bump the version', () => {
    // Adding, removing, renaming, re-windowing or re-defining a key moves this hash. When it
    // moves, bump WEB_FRAME_VERSION and update the literal here — in that order, deliberately,
    // because a frame written before and after a silent change would otherwise be compared by a
    // consumer with neither noticing. §8.2: "a change is a new frame_version".
    expect(featureSpecFingerprint()).toBe('3efcf553');
    expect(WEB_FRAME_VERSION).toBe(1);
  });

  it('carries every §8.2 group', () => {
    expect(WEB_FEATURE_KEYS).toHaveLength(42);
    for (const prefix of ['funding.', 'oi.', 'ls.', 'cvd.', 'atr.', 'structure.', 'liq.', 'px.', 'label.']) {
      expect(WEB_FEATURE_KEYS.some((k) => k.startsWith(prefix))).toBe(true);
    }
  });

  it('declares a type, a window and a definition for every key', () => {
    for (const key of WEB_FEATURE_KEYS) {
      const entry = WEB_FEATURE_SPEC[key] as { type: string; window: string; def: string };
      expect(entry.type).toMatch(/^(number|boolean|count|enum)$/);
      expect(entry.window.length).toBeGreaterThan(0);
      // the def is where MEANING lives — the one thing the fingerprint cannot infer
      expect(entry.def.length).toBeGreaterThan(10);
    }
  });

  it('says WILDER in the ATR definitions, because the obvious reuse is the wrong statistic', () => {
    for (const key of ['atr.1h.14', 'atr.4h.14', 'atr.1d.14'] as const) {
      expect(WEB_FEATURE_SPEC[key].def).toContain('WILDER');
    }
  });
});

describe('a value is a measurement or a stated refusal', () => {
  it('accepts both shapes and rejects a bare null', () => {
    expect(WebFeatureValueSchema.safeParse({ ok: true, value: 1.5 }).success).toBe(true);
    expect(WebFeatureValueSchema.safeParse({ ok: false, why: 'insufficient_history' }).success).toBe(true);
    expect(WebFeatureValueSchema.safeParse(null).success).toBe(false);
    expect(WebFeatureValueSchema.safeParse({ ok: true, value: null }).success).toBe(false);
  });

  it('carries a count WITH its denominator, and rejects a bare count', () => {
    // "3 of 20 venues extreme" and "3 of 3" are opposite facts behind the same number.
    expect(WebFeatureValueSchema.safeParse({ ok: true, value: { count: 2, of: 3 } }).success).toBe(true);
    expect(WebFeatureValueSchema.safeParse({ ok: true, value: { count: 2 } }).success).toBe(false);
  });

  it('CANNOT express "unavailable" without saying why', () => {
    expect(WebFeatureValueSchema.safeParse({ ok: false }).success).toBe(false);
  });

  it('requireFeature throws rather than returning a stand-in', () => {
    expect(() => requireFeature({ ok: false, why: 'no_data' }, 'oi.d24h_pct')).toThrow(/not computable/);
    expect(requireFeature({ ok: true, value: 3 }, 'oi.d24h_pct')).toBe(3);
  });

  it('featureOr makes the substitution visible at the call site', () => {
    expect(featureOr({ ok: false, why: 'no_data' }, 0)).toBe(0);
    expect(featureOr({ ok: true, value: 7 }, 0)).toBe(7);
  });
});

describe('canArm — the rule that replaces the flag', () => {
  const frame = (keys: Record<string, { ok: true; value: number } | { ok: false; why: 'no_data' }>) =>
    WebFeatureFrameSchema.parse({
      symbol: 'BTCUSDT', tf: '15m', closeTime: 1_791_000_000, frameVersion: WEB_FRAME_VERSION,
      keys, basis: { venues: ['bybit'], coverage: 'not_recorded', coveredHours: null },
      complete: Object.values(keys).every((v) => v.ok), incompleteReason: [],
    });

  it('arms when every REQUIRED key computed, even on an incomplete frame', () => {
    // The reason the frame is written rather than skipped: a valid OI delta is not worth
    // discarding because funding had no history.
    const f = frame({ 'oi.d24h_pct': { ok: true, value: 2 }, 'funding.okx.rate': { ok: false, why: 'no_data' } });
    expect(f.complete).toBe(false);
    expect(canArm(f, ['oi.d24h_pct'])).toBe(true);
  });

  it('REFUSES when a required key is not computable, whatever `complete` says', () => {
    const f = frame({ 'oi.d24h_pct': { ok: true, value: 2 }, 'funding.okx.rate': { ok: false, why: 'no_data' } });
    expect(canArm(f, ['oi.d24h_pct', 'funding.okx.rate'])).toBe(false);
  });

  it('REFUSES a key the frame does not carry at all, rather than treating absent as fine', () => {
    expect(canArm(frame({ 'oi.d24h_pct': { ok: true, value: 2 } }), ['liq.long.z60m'])).toBe(false);
  });
});

describe('the frame row', () => {
  it('will not accept a nullable complete flag', () => {
    const base = {
      symbol: 'BTCUSDT', tf: '15m', closeTime: 1_791_000_000, frameVersion: 1,
      keys: {}, basis: { venues: [], coverage: 'no_events', coveredHours: null }, incompleteReason: [],
    };
    expect(WebFeatureFrameSchema.safeParse({ ...base, complete: null }).success).toBe(false);
    expect(WebFeatureFrameSchema.safeParse({ ...base, complete: false }).success).toBe(true);
  });

  it('keeps coveredHours nullable, because "not recorded" is not zero hours', () => {
    const ok = WebFeatureFrameSchema.safeParse({
      symbol: 'BTCUSDT', tf: '4h', closeTime: 1, frameVersion: 1, keys: {}, complete: true,
      incompleteReason: [], basis: { venues: ['okx'], coverage: 'not_recorded', coveredHours: null },
    });
    expect(ok.success).toBe(true);
  });
});
