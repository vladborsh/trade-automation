import {
  WEB_FEATURE_KEYS, WEB_FEATURE_SPEC, WEB_FRAME_VERSION, WebFeatureFrameSchema,
  WebFeatureValueSchema, canArm, featureOr, featureSpecFingerprint, requireFeature,
  type WebFeatureSpecEntry,
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
    expect(featureSpecFingerprint()).toBe('18fc2286');
    expect(WEB_FRAME_VERSION).toBe(1);
  });

  it('CHANGING A WINDOW MOVES THE FINGERPRINT, not just a comment', () => {
    // The gap this closes: a fingerprint over names and types stays green while a percentile
    // window goes 90 -> 60 or an ATR period 14 -> 20. Asserted by actually perturbing a param
    // rather than trusting that it is included.
    const base = featureSpecFingerprint();
    const clone = JSON.parse(JSON.stringify(WEB_FEATURE_SPEC)) as Record<string, WebFeatureSpecEntry>;

    /** A clone with one param replaced — the registry is deeply readonly, as it should be. */
    const withParam = (key: string, name: string, value: string | number) => {
      const clone = JSON.parse(JSON.stringify(WEB_FEATURE_SPEC)) as Record<string, WebFeatureSpecEntry>;
      clone[key] = { ...clone[key], params: { ...clone[key].params, [name]: value } };
      return clone;
    };

    expect(featureSpecFingerprint(withParam('funding.binance.pct30d', 'settlements', 60))).not.toBe(base);
    expect(featureSpecFingerprint(withParam('atr.4h.14', 'period', 20))).not.toBe(base);
    // and the venue-set rule behind the denominator, which is a rule rather than a number
    expect(featureSpecFingerprint(withParam('funding.extreme_hi_venues', 'denominator', 'venues_configured'))).not.toBe(base);
  });

  it('INCLUDES `inputs`, because which bars a key reads is what it means', () => {
    // And it decides which incomplete bucket poisons the key, so a silent change here would
    // change both the number and which shortfalls it survives.
    const clone = JSON.parse(JSON.stringify(WEB_FEATURE_SPEC)) as Record<string, WebFeatureSpecEntry>;
    clone['atr.4h.14'] = { ...clone['atr.4h.14'], inputs: ['agg:1h'] };
    expect(featureSpecFingerprint(clone)).not.toBe(featureSpecFingerprint());
  });

  it('declares an input group for every key, so none is silently unblockable', () => {
    // A key with no inputs could never be refused for incompleteness, whatever was short.
    for (const key of WEB_FEATURE_KEYS) {
      expect(WEB_FEATURE_SPEC[key].inputs.length).toBeGreaterThan(0);
    }
  });

  it('INCLUDES `def`, so a change of meaning in prose still moves the hash', () => {
    // Deliberate, with its cost accepted: a wording-only improvement forces a version bump and a
    // one-line note saying the meaning did not change. The alternative is worse — a calculator
    // going from "percentile of the last rate" to "percentile of the mean of the last three"
    // with params untouched would otherwise pass silently.
    const clone = JSON.parse(JSON.stringify(WEB_FEATURE_SPEC)) as Record<string, WebFeatureSpecEntry>;
    clone['funding.binance.rate'] = { ...clone['funding.binance.rate'], def: 'something else entirely' };
    expect(featureSpecFingerprint(clone)).not.toBe(featureSpecFingerprint());
  });

  it('is not moved by the ORDER params happen to be written in', () => {
    // Otherwise a harmless reformat would demand a version bump and the rule would be ignored.
    const reordered = Object.fromEntries(Object.entries(
      JSON.parse(JSON.stringify(WEB_FEATURE_SPEC)) as Record<string, { params: Record<string, unknown> }>,
    ).map(([key, entry]) => [key, {
      ...entry,
      params: Object.fromEntries(Object.entries(entry.params).reverse()),
    }])) as never;
    expect(featureSpecFingerprint(reordered)).toBe(featureSpecFingerprint());
  });

  it('every meaning-defining constant lives in params, so none can change silently', () => {
    // Spot-check the ones a calculator would otherwise be tempted to hard-code.
    expect(WEB_FEATURE_SPEC['funding.binance.pct30d'].params).toMatchObject({
      settlements: 90, minPeriods: 45,
      // the convention the key NAME depends on: 90 settlements is 30 days only at 8-hourly
      settlementHours: 8, intervalTolerance: 0.25,
    });
    expect(WEB_FEATURE_SPEC['atr.1h.14'].params).toMatchObject({ period: 14, smoothing: 'wilder' });
    expect(WEB_FEATURE_SPEC['liq.long.z60m'].params).toMatchObject({ lookbackDays: 30, minHistoryDays: 14, transform: 'log1p' });
    expect(WEB_FEATURE_SPEC['structure.failed_highs_24h'].params).toMatchObject({ atrMultiple: 0.5, atrTf: '1h' });
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

  it('says wilder in the ATR params, because the obvious reuse is the wrong statistic', () => {
    // In params rather than prose: libs/indicators' computeAtr is the arithmetic mean of true
    // range, and switching to it would otherwise change three keys without moving the hash.
    for (const key of ['atr.1h.14', 'atr.4h.14', 'atr.1d.14'] as const) {
      expect(WEB_FEATURE_SPEC[key].params.smoothing).toBe('wilder');
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
