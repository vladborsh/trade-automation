import type { WebFeatureFrame } from '@trade-automation/contracts';
import { NO_REGIME_AXES, evaluateContextGate, type ReadRegimeAxis } from '../../src/playbooks/gate';
import type { ContextGate } from '../../src/playbooks/config';

/**
 * IB-017 — D9's one context gate.
 *
 * The assertions below are mostly about the THIRD outcome. A gate that can only pass or fail
 * turns our own outages into evidence against the gate, and that evidence decides whether a
 * playbook ships.
 */
const frame = (keys: WebFeatureFrame['keys']): WebFeatureFrame => ({
  symbol: 'BTCUSDT', tf: '15m', closeTime: 1_760_000_000, frameVersion: 1,
  keys, basis: { venues: [], coverage: 'not_recorded', coveredHours: null },
  complete: false, incompleteReason: [], revision: 1, amendedAt: null, amendedKeys: [],
  computedMode: 'live', computedAt: 1_760_000_015,
});

const axis = (read: ReturnType<ReadRegimeAxis>): ReadRegimeAxis => () => read;

describe('a feature-key gate', () => {
  const gate: ContextGate = { observable: 'oi.d4h_pct', op: '<=', value: -8 };

  it('passes when the key satisfies it', () => {
    const v = evaluateContextGate(gate, frame({ 'oi.d4h_pct': { ok: true, value: -12 } }));
    expect(v.status).toBe('pass');
    expect(v.actual).toBe(-12);
  });

  it('BLOCKS when the key is read and does not satisfy it', () => {
    expect(evaluateContextGate(gate, frame({ 'oi.d4h_pct': { ok: true, value: 3 } })).status)
      .toBe('blocked');
  });

  it('is UNAVAILABLE when the key refused — never a failed comparison', () => {
    // The difference decides whether this close counts in the experiment. Treating a refusal as
    // "did not pass" is how a fortnight of missing history becomes evidence against a gate.
    const v = evaluateContextGate(gate, frame({ 'oi.d4h_pct': { ok: false, why: 'no_data' } }));
    expect(v.status).toBe('unavailable');
    expect(v.status === 'unavailable' && v.refusal).toBe('gate_key_unavailable');
    expect(v.actual).toBeNull();
  });

  it('is UNAVAILABLE when the key is not in the frame at all', () => {
    // A config naming a key removed by a version bump is an operational fact to fail closed on,
    // not a crash that stops the pass for every symbol.
    expect(evaluateContextGate(gate, frame({})).status).toBe('unavailable');
  });

  it('is UNAVAILABLE for a composite value, which has no ordering', () => {
    const v = evaluateContextGate(gate, frame({
      'funding.extreme_hi_venues': { ok: true, value: { count: 2, of: 3 } as never },
    } as never));
    expect(v.status).toBe('unavailable');
  });

  it('does NOT compare a string with an ordering operator', () => {
    // JavaScript answers 'UP' < 5 lexicographically and the answer looks like a number
    // comparison. Blocked, never a silent pass.
    const v = evaluateContextGate(
      { observable: 'label.p4', op: '<', value: 5 },
      frame({ 'label.p4': { ok: true, value: 'SPOT_LED' } }),
    );
    expect(v.status).toBe('blocked');
  });
});

describe('a regime-axis gate', () => {
  const gate: ContextGate = { observable: 'regime.trend', op: 'in', value: ['UP', 'RANGE'] };

  it('passes and blocks on the axis value', () => {
    expect(evaluateContextGate(gate, frame({}), axis({ status: 'ok', value: 'UP' })).status).toBe('pass');
    expect(evaluateContextGate(gate, frame({}), axis({ status: 'ok', value: 'DOWN' })).status).toBe('blocked');
  });

  it('carries the axis OWN refusal through rather than flattening it', () => {
    // dev-1's evaluateRegimeGate returns the axis's why. An unshowable calendar is
    // `calendar_unknown` and must never arrive as EVENT_RISK or as a plain non-pass.
    const v = evaluateContextGate(
      { observable: 'regime.event_window', op: 'in', value: ['CLEAR'] },
      frame({}),
      axis({ status: 'unavailable', why: 'calendar_unknown' }),
    );
    expect(v.status).toBe('unavailable');
    expect(v.status === 'unavailable' && v.refusal).toBe('calendar_unknown');
  });

  it('FAILS CLOSED while IB-016 is unmerged, rather than passing or throwing', () => {
    // Passing would arm on an unverified premise; throwing would take the unconditional arm
    // down with it. Unavailable is the honest answer and removes the close from the comparison.
    const v = evaluateContextGate(gate, frame({}), NO_REGIME_AXES);
    expect(v.status).toBe('unavailable');
    expect(v.status === 'unavailable' && v.refusal).toBe('gate_axis_unavailable');
  });
});

describe('the operators', () => {
  const on = (value: number) => frame({ 'oi.d4h_pct': { ok: true, value } });
  const check = (op: ContextGate['op'], threshold: ContextGate['value'], value: number) =>
    evaluateContextGate({ observable: 'oi.d4h_pct', op, value: threshold }, on(value)).status;

  it('is exact at the boundary for each ordering operator', () => {
    expect(check('<=', -8, -8)).toBe('pass');
    expect(check('<', -8, -8)).toBe('blocked');
    expect(check('>=', -8, -8)).toBe('pass');
    expect(check('>', -8, -8)).toBe('blocked');
  });

  it('handles in and not_in as set membership', () => {
    expect(check('in', [-8, -12], -12)).toBe('pass');
    expect(check('not_in', [-8, -12], -12)).toBe('blocked');
    expect(check('not_in', [-8, -12], -3)).toBe('pass');
  });

  it('records the observable and threshold on the verdict, whatever it decided', () => {
    // The verdict is written to the audit row: "which gate, against what" has to survive
    // without re-reading the config version that produced it.
    const v = evaluateContextGate({ observable: 'oi.d4h_pct', op: '<=', value: -8 }, on(-12));
    expect(v.observable).toBe('oi.d4h_pct');
    expect(v.op).toBe('<=');
    expect(v.value).toBe(-8);
  });
});
