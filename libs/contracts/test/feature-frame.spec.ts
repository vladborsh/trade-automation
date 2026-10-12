import {
  WEB_FEATURE_KEYS, WEB_FEATURE_SPEC, WEB_FRAME_VERSION, WebFeatureFrameSchema,
  WebFeatureValueSchema, assertSingleComputedMode, canArm, featureOr, featureSpecFingerprint,
  latestRevisions, liveRevisions, requireFeature,
  type WebFeatureFrame, type WebFeatureSpecEntry,
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
    expect(featureSpecFingerprint()).toBe('14f15ddd');
    // Still 1, and that is a decision with an expiry date rather than an oversight. IB-016 added
    // px.close, ema.4h.50 and ema.1d.200 on 2026-10-12, when NOTHING had ever been persisted
    // under version 1 — so no stored frame means something different from a new one and there is
    // nothing to be incomparable with. The moment real frames exist, the next change to this
    // registry bumps the version and dual-reads. `feature_frame_versions` enforces it from the
    // database rather than from this comment.
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
    expect(WEB_FEATURE_SPEC['liq.long.z60m'].params).toMatchObject({
      lookbackDays: 30, minHistoryDays: 14, transform: 'log1p',
      // decides value-or-refusal, so it is meaning-defining and must be fingerprinted
      spreadEpsilonRelative: 1e-9,
    });
    expect(WEB_FEATURE_SPEC['structure.failed_highs_24h'].params).toMatchObject({ atrMultiple: 0.5, atrTf: '1h' });
  });

  it('carries every §8.2 group', () => {
    expect(WEB_FEATURE_KEYS).toHaveLength(47);
    for (const prefix of ['funding.', 'oi.', 'ls.', 'cvd.', 'atr.', 'structure.', 'liq.', 'px.', 'ema.', 'label.']) {
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
      revision: 1, amendedAt: null, amendedKeys: [],
      computedMode: 'live', computedAt: 1_760_000_015, specFingerprint: '14f15ddd',
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
      revision: 1, amendedAt: null, amendedKeys: [],
      computedMode: 'live', computedAt: 1_760_000_015, specFingerprint: '14f15ddd',
    };
    expect(WebFeatureFrameSchema.safeParse({ ...base, complete: null }).success).toBe(false);
    expect(WebFeatureFrameSchema.safeParse({ ...base, complete: false }).success).toBe(true);
  });

  it('REQUIRES a revision, so an unversioned frame cannot be stored', () => {
    // Append-only is only meaningful if every row says which revision it is.
    const base = {
      symbol: 'BTCUSDT', tf: '15m' as const, closeTime: 1, frameVersion: 1, keys: {},
      basis: { venues: [], coverage: 'no_events' as const, coveredHours: null },
      complete: true, incompleteReason: [], amendedAt: null, amendedKeys: [],
      computedMode: 'live', computedAt: 1_760_000_015, specFingerprint: '14f15ddd',
    };
    expect(WebFeatureFrameSchema.safeParse(base).success).toBe(false);
    expect(WebFeatureFrameSchema.safeParse({ ...base, revision: 0 }).success).toBe(false);
    expect(WebFeatureFrameSchema.safeParse({ ...base, revision: 1 }).success).toBe(true);
  });

  it('keeps coveredHours nullable, because "not recorded" is not zero hours', () => {
    const ok = WebFeatureFrameSchema.safeParse({
      symbol: 'BTCUSDT', tf: '4h', closeTime: 1, frameVersion: 1, keys: {}, complete: true,
      incompleteReason: [], basis: { venues: ['okx'], coverage: 'not_recorded', coveredHours: null },
      revision: 1, amendedAt: null, amendedKeys: [],
      computedMode: 'live', computedAt: 1_760_000_015, specFingerprint: '14f15ddd',
    });
    expect(ok.success).toBe(true);
  });
});

/**
 * IB-016 — the three keys dev-1 specified for `regime`'s trend axis, asserted here because the
 * registry is the contract between us: dev-1 reads these and does not own them.
 */
/**
 * IB-018 — the frame bar's high and low. The assertions are almost entirely about the `def`,
 * because the implementation is a two-line reduction and the DERIVATION is the thing that gets
 * lost.
 */
describe('px.high and px.low', () => {
  it('reads the same input group as px.close but declares a different aggregation', () => {
    // Same group, different derivation. That is exactly the pair someone collapses.
    expect(WEB_FEATURE_SPEC['px.high'].inputs).toEqual(['agg:15m']);
    expect(WEB_FEATURE_SPEC['px.high'].params).toEqual({ source: 'high', barTf: '15m', aggregation: 'max' });
    expect(WEB_FEATURE_SPEC['px.low'].params).toEqual({ source: 'low', barTf: '15m', aggregation: 'min' });
    expect(WEB_FEATURE_SPEC['px.close'].params).not.toHaveProperty('aggregation');
  });

  it('does NOT reuse px.close\'s wording, which would be wrong on a 4h frame', () => {
    // px.close can say "the 15m bar whose close coincides with the 4h close" because a 4h close
    // IS that bar's close. A 4h high is the max over sixteen bars. Borrow the phrasing and the
    // next reader simplifies it to the final bar's high, and P3's stop quietly moves.
    expect(WEB_FEATURE_SPEC['px.high'].def).toContain('MAXIMUM');
    expect(WEB_FEATURE_SPEC['px.low'].def).toContain('MINIMUM');
    expect(WEB_FEATURE_SPEC['px.high'].def).toContain('sixteen');
    expect(WEB_FEATURE_SPEC['px.high'].def).not.toContain('coincides with the 4h close');
  });

  it('warns in the def against the simplification itself', () => {
    // Not only what it IS, but what it is not: the def names the wrong answer so a reader who
    // arrives with it already in mind is contradicted rather than merely uninformed.
    expect(WEB_FEATURE_SPEC['px.high'].def).toContain('not the final 15m bar high');
  });

  it('puts the aggregation inside the fingerprint', () => {
    const before = featureSpecFingerprint();
    const swapped = {
      ...WEB_FEATURE_SPEC,
      'px.high': { ...WEB_FEATURE_SPEC['px.high'], params: { source: 'high', barTf: '15m', aggregation: 'last' } },
    };
    expect(featureSpecFingerprint(swapped)).not.toBe(before);
  });
});

describe('the IB-016 trend keys', () => {
  it('carries the EMA length, bar timeframe and SEED as parameters', () => {
    // `seed` is meaning, not implementation. An EMA seeded with the first close and one seeded
    // with the SMA of the first `length` closes disagree for roughly `length` bars and then
    // converge — two readers of "EMA200" getting different numbers for 200 days and identical
    // ones after is the hardest kind of disagreement to notice, so it is fingerprinted.
    expect(WEB_FEATURE_SPEC['ema.4h.50'].params).toEqual({ length: 50, barTf: '4h', source: 'close', seed: 'sma' });
    expect(WEB_FEATURE_SPEC['ema.1d.200'].params).toEqual({ length: 200, barTf: '1d', source: 'close', seed: 'sma' });
  });

  it('reads each EMA from the aggregate of its OWN bar timeframe', () => {
    expect(WEB_FEATURE_SPEC['ema.4h.50'].inputs).toEqual(['agg:4h']);
    expect(WEB_FEATURE_SPEC['ema.1d.200'].inputs).toEqual(['agg:1d']);
  });

  it('makes px.close a key, so the trend input carries a refusal reason like everything else', () => {
    // The alternative — passing the close alongside the frame — would leave one input outside
    // the completeness rule exactly where a trend decision is made.
    expect(WEB_FEATURE_KEYS).toContain('px.close');
    expect(WEB_FEATURE_SPEC['px.close'].type).toBe('number');
    expect(WEB_FEATURE_SPEC['px.close'].inputs).toEqual(['agg:15m']);
  });

  it('says in px.close’s def WHICH bar’s close it is on a 4h frame', () => {
    // The thing to prevent: a later reader seeing `agg:15m` on a 4h frame and concluding the
    // frame carries a 15-minute close. It carries the frame bar's close, which for a 4h frame
    // is the close of its final 15m constituent — measured identical on 1235 of 1235 pairs.
    expect(WEB_FEATURE_SPEC['px.close'].def).toContain('4h frame');
    expect(WEB_FEATURE_SPEC['px.close'].def).toContain('3h45m');
  });

  it('puts the EMA lengths inside the fingerprint, so retuning one cannot be silent', () => {
    const before = featureSpecFingerprint();
    const retuned = {
      ...WEB_FEATURE_SPEC,
      'ema.1d.200': { ...WEB_FEATURE_SPEC['ema.1d.200'], params: { length: 100, barTf: '1d', source: 'close', seed: 'sma' } },
    };
    expect(featureSpecFingerprint(retuned)).not.toBe(before);
  });

  it('puts the SEED inside the fingerprint too, which is the subtle one', () => {
    const before = featureSpecFingerprint();
    const reseeded = {
      ...WEB_FEATURE_SPEC,
      'ema.4h.50': { ...WEB_FEATURE_SPEC['ema.4h.50'], params: { length: 50, barTf: '4h', source: 'close', seed: 'first' } },
    };
    expect(featureSpecFingerprint(reseeded)).not.toBe(before);
  });
});

/**
 * IB-015 — provenance, and the two helpers IB-017's arming and IB-023's outcome tracking need.
 *
 * The hazard is specific, not tidiness: derive's heal pass fills short buckets after the fact,
 * so a backfilled frame is systematically better informed than the live frame for the same
 * close. Learning or backtesting across a mixed set trains on information that did not exist at
 * the moment it claims to model, by an amount nobody can measure.
 */
describe('computedMode', () => {
  const frame = (over: Partial<WebFeatureFrame> = {}): WebFeatureFrame => ({
    symbol: 'BTCUSDT', tf: '15m', closeTime: 1_760_000_000, frameVersion: WEB_FRAME_VERSION,
    keys: { 'px.close': { ok: true, value: 1 } },
    basis: { venues: [], coverage: 'not_recorded', coveredHours: null },
    complete: true, incompleteReason: [], revision: 1, amendedAt: null, amendedKeys: [],
    computedMode: 'live', computedAt: 1_760_000_015,
    specFingerprint: featureSpecFingerprint(),
    ...over,
  });

  it('is REQUIRED — a frame cannot be parsed without saying which it is', () => {
    // No default, deliberately. A default would let a new writer silently inherit `live` and
    // reintroduce the indistinguishability the field exists to remove.
    const { computedMode: _omitted, ...withoutMode } = frame();
    expect(() => WebFeatureFrameSchema.parse(withoutMode)).toThrow();
  });

  it('accepts only live and backfill', () => {
    expect(() => WebFeatureFrameSchema.parse(frame({ computedMode: 'guessed' as never }))).toThrow();
  });

  it('is per REVISION: a backfill amending a live frame is the case it exists for', () => {
    const live = frame({ revision: 1, computedMode: 'live' });
    const amended = frame({ revision: 2, computedMode: 'backfill', amendedKeys: ['px.close'] });
    expect(latestRevisions([live, amended])[0]?.computedMode).toBe('backfill');
  });

  it('liveRevisions falls back to the LIVE revision rather than the latest one', () => {
    // A bar whose revision 2 was backfilled must still answer "what was knowable at the close"
    // with revision 1 — not disappear, and not quietly return the better-informed answer.
    const live = frame({ revision: 1, computedMode: 'live' });
    const amended = frame({ revision: 2, computedMode: 'backfill' });
    const result = liveRevisions([live, amended]);
    expect(result).toHaveLength(1);
    expect(result[0]?.revision).toBe(1);
  });

  it('liveRevisions drops a bar that was ONLY ever backfilled', () => {
    // Correct: nothing was knowable at that close, because no frame existed then.
    expect(liveRevisions([frame({ computedMode: 'backfill' })])).toEqual([]);
  });

  it('assertSingleComputedMode THROWS on a mixed set, naming the lookahead', () => {
    expect(() => assertSingleComputedMode([
      frame({ computedMode: 'live' }),
      frame({ closeTime: 1_760_000_900, computedMode: 'backfill' }),
    ])).toThrow(/lookahead/);
  });

  it('accepts a set that is all one mode, in either direction', () => {
    expect(() => assertSingleComputedMode([frame(), frame({ closeTime: 1_760_000_900 })])).not.toThrow();
    expect(() => assertSingleComputedMode([
      frame({ computedMode: 'backfill' }),
      frame({ closeTime: 1_760_000_900, computedMode: 'backfill' }),
    ])).not.toThrow();
  });

  it('accepts an empty set rather than throwing on nothing', () => {
    expect(() => assertSingleComputedMode([])).not.toThrow();
  });

  it('carries computedAt separately from closeTime — their distance IS the healing window', () => {
    const backfilled = frame({ closeTime: 1_760_000_000, computedAt: 1_760_086_400, computedMode: 'backfill' });
    expect(WebFeatureFrameSchema.parse(backfilled).computedAt - backfilled.closeTime).toBe(86_400);
  });

  it('does NOT move the spec fingerprint — provenance is not key meaning', () => {
    // The fingerprint is over the key registry. Adding a field that describes how a frame was
    // produced says nothing about what any key MEANS, so stored frames stay comparable and the
    // version does not bump.
    expect(featureSpecFingerprint()).toBe('14f15ddd');
  });
});

/**
 * IB-049 — the frame carries the fingerprint of the spec that produced it.
 *
 * `frameVersion` is the weak identifier: a number a human assigns and can forget to bump while
 * the key set changes under it. This one is derived from the key set, so it cannot be forgotten
 * — and that difference is the whole reason the field exists.
 */
describe('specFingerprint', () => {
  const frame = (over: Partial<WebFeatureFrame> = {}): WebFeatureFrame => ({
    symbol: 'BTCUSDT', tf: '15m', closeTime: 1_760_000_000, frameVersion: WEB_FRAME_VERSION,
    keys: { 'px.close': { ok: true, value: 1 } },
    basis: { venues: [], coverage: 'not_recorded', coveredHours: null },
    complete: true, incompleteReason: [], revision: 1, amendedAt: null, amendedKeys: [],
    computedMode: 'live', computedAt: 1_760_000_015, specFingerprint: '14f15ddd',
    ...over,
  });

  it('is REQUIRED — a frame cannot be parsed without saying which spec produced it', () => {
    const { specFingerprint: _omitted, ...without } = frame();
    expect(() => WebFeatureFrameSchema.parse(without)).toThrow();
  });

  it('rejects an empty string, which would be a fingerprint that identifies nothing', () => {
    expect(() => WebFeatureFrameSchema.parse(frame({ specFingerprint: '' }))).toThrow();
  });

  it('can disagree with the frameVersion, which is the case it exists to expose', () => {
    // Two frames both calling themselves version 1 while carrying different key sets is exactly
    // what happened: 903 frames at 45 keys and 2 at 47, all version 1, distinguishable only by
    // counting keys per row. The type must be able to represent the disagreement, or nobody can
    // detect it.
    const old = frame({ specFingerprint: '7a4a2a87' });
    const current = frame({ specFingerprint: '14f15ddd' });
    expect(old.frameVersion).toBe(current.frameVersion);
    expect(old.specFingerprint).not.toBe(current.specFingerprint);
    expect(() => WebFeatureFrameSchema.parse(old)).not.toThrow();
  });

  it('does not move the spec fingerprint — the frame SHAPE is not the key registry', () => {
    // Adding a field describing how a frame was produced says nothing about what any key means,
    // so stored frames stay comparable and the version does not bump.
    expect(featureSpecFingerprint()).toBe('14f15ddd');
  });
});
