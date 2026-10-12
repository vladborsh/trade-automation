import {
  WEB_FEATURE_KEYS, WEB_FEATURE_PERMANENT_REASONS, WEB_FEATURE_SPEC, WEB_FRAME_VERSION, canArm,
  type WebFeatureKey, type WebFeatureValue,
} from '@trade-automation/contracts';
import {
  assembleFrame, attemptOffsetsMs, isFinalAttempt, keysBlockedBy, type AssembleInput,
} from '../../src/features/frame-assembly';

/**
 * IB-015 — the refusal path. §8.1's rule is that nothing arms on an unhealed bucket, and these
 * are the assertions that hold the code to it.
 */

const CLOSE = Date.UTC(2026, 9, 12, 12, 0, 0) / 1000;

/** Every key computed, so a test can then spoil exactly the ones it means to. */
const allComputed = (): Partial<Record<WebFeatureKey, WebFeatureValue>> =>
  Object.fromEntries(WEB_FEATURE_KEYS.map((k) => [k, { ok: true, value: 1 }]));

const input = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  symbol: 'BTCUSDT',
  tf: '15m',
  closeTimeSec: CLOSE,
  computed: allComputed(),
  incompleteKeys: new Set<string>(),
  explainedKeys: new Set<string>(),
  reasons: [],
  basis: { venues: ['bybit', 'okx'], coverage: 'not_recorded', coveredHours: null },
  computedMode: 'live',
  computedAtSec: CLOSE + 15,
  ...over,
});

describe('keysBlockedBy', () => {
  it('blocks exactly the keys reading the incomplete group', () => {
    const blocked = keysBlockedBy(new Set(['agg:4h']));
    expect(blocked).toContain('atr.4h.14');
    expect(blocked).not.toContain('atr.1h.14');
    expect(blocked).not.toContain('funding.binance.rate');
  });

  it('blocks a key that reads SEVERAL groups when ANY of them is short', () => {
    // failed_highs_24h needs 15m bars and the 1h ATR; either being short poisons it.
    expect(keysBlockedBy(new Set(['agg:1h']))).toContain('structure.failed_highs_24h');
    expect(keysBlockedBy(new Set(['agg:15m']))).toContain('structure.failed_highs_24h');
  });

  it('blocks nothing when everything is complete', () => {
    expect(keysBlockedBy(new Set())).toEqual([]);
  });
});

describe('assembleFrame', () => {
  it('writes the frame rather than skipping it, and marks it incomplete', () => {
    // A skipped frame is indistinguishable from "the pass was not running".
    const frame = assembleFrame(input({
      incompleteKeys: new Set(['oi.binance.now', 'oi.d24h_pct']),
      reasons: ['open_interest_5m slot 12:00 missing'],
    }));
    expect(frame.complete).toBe(false);
    expect(frame.incompleteReason).toEqual(['open_interest_5m slot 12:00 missing']);
    expect(frame.closeTime).toBe(CLOSE);
    expect(frame.frameVersion).toBe(WEB_FRAME_VERSION);
  });

  it('THE REFUSAL BEATS A COMPUTED VALUE', () => {
    // The case that matters: a calculator DID produce a number from the short bucket. Publishing
    // it would be a measurement of an unhealed bar, which is the artefact §8.1 forbids.
    const frame = assembleFrame(input({ incompleteKeys: new Set(['oi.binance.now', 'oi.d24h_pct']) }));
    expect(frame.keys['oi.d24h_pct']).toEqual({ ok: false, why: 'incomplete_input' });
  });

  it('KEEPS the keys that were not affected', () => {
    // Skipping the frame would have thrown these away over an unrelated short bucket.
    const frame = assembleFrame(input({ incompleteKeys: new Set(['oi.binance.now', 'oi.d24h_pct']) }));
    expect(frame.keys['funding.binance.rate']).toEqual({ ok: true, value: 1 });
    expect(frame.keys['atr.4h.14']).toEqual({ ok: true, value: 1 });
  });

  it('AN INCOMPLETE FRAME CANNOT ARM A PLAYBOOK THAT NEEDS THE BLOCKED KEY', () => {
    // §8.1's actual requirement, asserted through the consumer's own gate rather than a flag.
    const frame = assembleFrame(input({ incompleteKeys: new Set(['atr.4h.14']) }));
    expect(canArm(frame, ['atr.4h.14'])).toBe(false);
    // ...and still arms one that does not need it, which is why the frame is written at all
    expect(canArm(frame, ['funding.binance.rate'])).toBe(true);
  });

  it('is complete only when every key computed', () => {
    expect(assembleFrame(input()).complete).toBe(true);
    const oneRefused = allComputed();
    oneRefused['liq.long.z60m'] = { ok: false, why: 'insufficient_history' };
    // a refusal for a reason OTHER than incompleteness still makes the frame incomplete
    expect(assembleFrame(input({ computed: oneRefused })).complete).toBe(false);
  });

  it('drops the reasons when nothing was short, so a complete frame carries no noise', () => {
    expect(assembleFrame(input({ reasons: ['stale'] })).incompleteReason).toEqual([]);
  });

  it('sorts the reasons, so two runs over the same shortfalls are byte-identical', () => {
    const a = assembleFrame(input({ incompleteKeys: new Set(['oi.binance.now', 'oi.d24h_pct']), reasons: ['b', 'a'] }));
    const b = assembleFrame(input({ incompleteKeys: new Set(['oi.binance.now', 'oi.d24h_pct']), reasons: ['a', 'b'] }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('THROWS on a key no calculator produced, rather than inventing a refusal for it', () => {
    // "Nobody computed this" is not "the market had no data", and a frame that filled the gap
    // with no_data would look complete in shape and be hollow.
    const missing = allComputed();
    delete missing['px.ret_4h'];
    expect(() => assembleFrame(input({ computed: missing }))).toThrow(/no value produced for "px.ret_4h"/);
  });

  it('emits every registry key, so a consumer never has to branch on absence', () => {
    expect(Object.keys(assembleFrame(input())).length).toBeGreaterThan(0);
    expect(Object.keys(assembleFrame(input()).keys).sort()).toEqual([...WEB_FEATURE_KEYS].sort());
  });
});

describe('the §8.1 re-check schedule', () => {
  it('looks at the grace, then at +30 s and +60 s', () => {
    expect(attemptOffsetsMs()).toEqual([15_000, 30_000, 60_000]);
  });

  it('knows which look is the last, because the pass does not wait for ever', () => {
    expect(isFinalAttempt(0)).toBe(false);
    expect(isFinalAttempt(1)).toBe(false);
    expect(isFinalAttempt(2)).toBe(true);
  });
});

/**
 * An EVIDENCED absence still refuses — it just refuses differently.
 *
 * `assessWindows` has always separated the two, but until now only the incomplete set reached
 * `assembleFrame`, so an explained shortfall fell straight through and the calculator's value
 * over a short window was published as if the window were whole. The tell was in the contract:
 * `explained_absence` is a declared refusal reason that no frame could hold.
 *
 * The case that makes it concrete: a symbol that listed at 02:00 has 120 of the 240 minutes the
 * 04:00 4 h close expects, every missing minute explained by the listing date. Its ATR over half
 * a window is not the 4 h ATR, and "the venue never produced those minutes" is a reason the data
 * is absent, not a licence to publish a statistic computed without it.
 */
describe('an explained absence', () => {
  it('refuses the keys reading that group, rather than publishing a half-window value', () => {
    const frame = assembleFrame(input({ explainedKeys: new Set(['atr.4h.14']) }));
    expect(frame.keys['atr.4h.14']).toEqual({ ok: false, why: 'explained_absence' });
  });

  it('refuses with a PERMANENT reason, so it is not chased as an unhealed gap', () => {
    const frame = assembleFrame(input({ explainedKeys: new Set(['atr.4h.14']) }));
    const why = (frame.keys['atr.4h.14'] as { ok: false; why: string }).why;
    expect(WEB_FEATURE_PERMANENT_REASONS).toContain(why);
    expect(why).not.toBe('incomplete_input');
  });

  it('leaves every other key alone', () => {
    const frame = assembleFrame(input({ explainedKeys: new Set(['atr.4h.14']) }));
    expect(frame.keys['funding.binance.rate']).toEqual({ ok: true, value: 1 });
  });

  it('still makes the frame incomplete — it holds a key nobody can compute', () => {
    const frame = assembleFrame(input({ explainedKeys: new Set(['atr.4h.14']) }));
    expect(frame.complete).toBe(false);
  });

  it('loses to incomplete_input when a key is in BOTH sets, because the gap is still chaseable', () => {
    // `structure.failed_highs_24h` reads agg:15m and agg:1h — named rather than discovered, so
    // the spec pins the real combination and fails if the registry stops having one.
    // One key can land in both sets when it reads two groups whose shortfalls differ in kind —
    // `structure.failed_highs_24h` reads agg:15m and agg:1h.
    expect(WEB_FEATURE_SPEC['structure.failed_highs_24h'].inputs).toEqual(['agg:15m', 'agg:1h']);
    const frame = assembleFrame(input({
      incompleteKeys: new Set(['structure.failed_highs_24h']),
      explainedKeys: new Set(['structure.failed_highs_24h']),
    }));
    expect(frame.keys['structure.failed_highs_24h']).toEqual({ ok: false, why: 'incomplete_input' });
  });
});

/**
 * IB-047 — blocking is PER KEY, which is the whole defect.
 *
 * Found by dev-1 auditing IB-018: 422 of 477 `px.*` refusals had their own 15m bar complete.
 * They were blocked because a sibling key in the same input group — `px.ret_24h`, needing
 * ninety-six bars — was short. The group was the unit; it should never have been.
 */
describe('per-key blocking', () => {
  it('does NOT block a narrow key because a wide sibling in its group was short', () => {
    // Both read agg:15m. px.ret_24h needs 96 bars, px.close needs one.
    expect(WEB_FEATURE_SPEC['px.close'].inputs).toEqual(WEB_FEATURE_SPEC['px.ret_24h'].inputs);
    const frame = assembleFrame(input({ incompleteKeys: new Set(['px.ret_24h']) }));
    expect(frame.keys['px.ret_24h']).toEqual({ ok: false, why: 'incomplete_input' });
    expect(frame.keys['px.close']).toEqual({ ok: true, value: 1 });
    expect(frame.keys['px.high']).toEqual({ ok: true, value: 1 });
    expect(frame.keys['px.low']).toEqual({ ok: true, value: 1 });
  });

  it('does not block atr.1d.14 because ema.1d.200 wants 200 bars', () => {
    // The same bug one group over, and worse: 15 daily bars inheriting a 200-bar requirement.
    const frame = assembleFrame(input({ incompleteKeys: new Set(['ema.1d.200']) }));
    expect(frame.keys['atr.1d.14']).toEqual({ ok: true, value: 1 });
  });

  it('ignores a key that is not in the registry rather than trusting the caller', () => {
    const frame = assembleFrame(input({ incompleteKeys: new Set(['px.clsoe']) }));
    expect(frame.complete).toBe(true);
  });

  it('still blocks every key genuinely named', () => {
    const frame = assembleFrame(input({ incompleteKeys: new Set(['px.close', 'px.ret_24h']) }));
    expect(frame.keys['px.close']).toEqual({ ok: false, why: 'incomplete_input' });
    expect(frame.keys['px.ret_24h']).toEqual({ ok: false, why: 'incomplete_input' });
  });
});
