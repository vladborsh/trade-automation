import { REGIME_OBSERVABLES, evaluateRegimeGate, readRegimeAxis, type RegimeObservable } from '../../src/regime/gate';
import type { RegimeContext } from '../../src/regime/context';

/**
 * IB-016 → IB-017: the gate read. The test that matters is the third outcome — a refused axis must
 * never arrive as "did not pass", because that is missing data silently becoming a decision not to
 * trade, in the direction nobody investigates.
 */

function context(overrides: Partial<RegimeContext> = {}): RegimeContext {
  return {
    symbol: 'BTCUSDT',
    closeTime: 1_790_000_000,
    tf: '4h',
    trend: { ok: true, value: 'UP' },
    vol: { ok: true, value: 'NORMAL' },
    leverage: { ok: true, value: 'LEVERED' },
    crowdedSide: { ok: true, value: 'LONGS' },
    eventWindow: { ok: true, value: 'CLEAR' },
    frameVersion: 1,
    frameRevision: 1,
    computedMode: 'live',
    regimeVersion: 1,
    specFingerprint: 'abcd1234',
    ...overrides,
  } as RegimeContext;
}

describe('evaluateRegimeGate', () => {
  const gate = { observable: 'regime.trend' as const, op: 'in' as const, value: ['UP', 'RANGE'] };

  it('passes on a measured value inside the set', () => {
    expect(evaluateRegimeGate(context(), gate)).toEqual({ outcome: 'pass', observed: 'UP' });
  });

  it('blocks on a measured value outside it, and says what it saw', () => {
    const outcome = evaluateRegimeGate(context({ trend: { ok: true, value: 'DOWN' } }), gate);
    expect(outcome).toEqual({ outcome: 'blocked', observed: 'DOWN' });
  });

  it('REFUSES rather than blocking when the axis could not be computed', () => {
    // the whole point: `insufficient_history` is not `DOWN`. A gate that reported this as "blocked"
    // would convert a missing EMA into a decision not to trade, and §8.3's measured comparison
    // against the unconditional arm would be a mixture of findings and blindness.
    const outcome = evaluateRegimeGate(
      context({ trend: { ok: false, why: 'insufficient_history' } }),
      gate,
    );
    expect(outcome).toEqual({
      outcome: 'gate_axis_unavailable',
      observable: 'regime.trend',
      why: 'insufficient_history',
    });
  });

  it('carries the axis’s own reason, so a long run of it names what to fix', () => {
    const reasons = ['no_data', 'incomplete_input', 'not_applicable'] as const;
    for (const why of reasons) {
      expect(evaluateRegimeGate(context({ trend: { ok: false, why } }), gate)).toMatchObject({
        outcome: 'gate_axis_unavailable',
        why,
      });
    }
  });

  it('blocks — never passes — on a value no axis can produce', () => {
    // a typo in playbook_config, or a label from a bumped REGIME_VERSION: the safe direction is
    // that the gate never fires, and `observed` makes the mismatch visible in tracking rather than
    // leaving a gate that is silently dead
    const typo = { observable: 'regime.trend' as const, op: 'in' as const, value: ['UPP'] };
    expect(evaluateRegimeGate(context(), typo)).toEqual({ outcome: 'blocked', observed: 'UP' });
  });

  it('has exactly three outcomes and no boolean shortcut', () => {
    // a caller that wants a boolean has to collapse it in the open, where a reviewer can see which
    // way it chose to fail
    const outcomes = new Set(
      [
        evaluateRegimeGate(context(), gate),
        evaluateRegimeGate(context({ trend: { ok: true, value: 'DOWN' } }), gate),
        evaluateRegimeGate(context({ trend: { ok: false, why: 'no_data' } }), gate),
      ].map((o) => o.outcome),
    );
    expect([...outcomes].sort()).toEqual(['blocked', 'gate_axis_unavailable', 'pass']);
  });
});

describe('readRegimeAxis', () => {
  it('reaches every axis the context carries, so none can be orphaned', () => {
    // adding an axis to RegimeContext without exposing it here would make it ungateable and
    // invisible to IB-023 — this fails the day that happens
    for (const observable of REGIME_OBSERVABLES) {
      expect(readRegimeAxis(context(), observable as RegimeObservable).ok).toBe(true);
    }
    expect(REGIME_OBSERVABLES).toHaveLength(5);
  });

  it('hands back the refusal intact rather than a null', () => {
    const axis = readRegimeAxis(context({ vol: { ok: false, why: 'incomplete_input' } }), 'regime.vol');
    expect(axis).toEqual({ ok: false, why: 'incomplete_input' });
  });
});
