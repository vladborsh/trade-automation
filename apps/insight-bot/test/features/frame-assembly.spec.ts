import {
  WEB_FEATURE_KEYS, WEB_FRAME_VERSION, canArm, type WebFeatureKey, type WebFeatureValue,
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
  incompleteGroups: new Set<string>(),
  reasons: [],
  basis: { venues: ['bybit', 'okx'], coverage: 'not_recorded', coveredHours: null },
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
      incompleteGroups: new Set(['oi']),
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
    const frame = assembleFrame(input({ incompleteGroups: new Set(['oi']) }));
    expect(frame.keys['oi.d24h_pct']).toEqual({ ok: false, why: 'incomplete_input' });
  });

  it('KEEPS the keys that were not affected', () => {
    // Skipping the frame would have thrown these away over an unrelated short bucket.
    const frame = assembleFrame(input({ incompleteGroups: new Set(['oi']) }));
    expect(frame.keys['funding.binance.rate']).toEqual({ ok: true, value: 1 });
    expect(frame.keys['atr.4h.14']).toEqual({ ok: true, value: 1 });
  });

  it('AN INCOMPLETE FRAME CANNOT ARM A PLAYBOOK THAT NEEDS THE BLOCKED KEY', () => {
    // §8.1's actual requirement, asserted through the consumer's own gate rather than a flag.
    const frame = assembleFrame(input({ incompleteGroups: new Set(['agg:4h']) }));
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
    const a = assembleFrame(input({ incompleteGroups: new Set(['oi']), reasons: ['b', 'a'] }));
    const b = assembleFrame(input({ incompleteGroups: new Set(['oi']), reasons: ['a', 'b'] }));
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
