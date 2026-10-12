import type { GateVerdict, WebFeatureFrame } from '@trade-automation/contracts';
import type { ContextGate } from './config';

/**
 * IB-017 — D9's one declared context gate, evaluated.
 *
 * Pure given an axis reader. The gate may name a regime axis (`regime.trend`) or a single
 * feature key (`oi.d4h_pct`); the first is dev-1's to answer and arrives through
 * `ReadRegimeAxis`, the second is read straight off the frame.
 *
 * **The whole point of this module is that "cannot answer" is a third outcome.** An observable
 * that is absent or refused is not a pass and not a veto: it fails closed under its own reason
 * and the close leaves the twin-arm comparison, because counting it as "the gated arm did not
 * arm" would read our own outage as the gate costing performance.
 */

/**
 * dev-1's read API (IB-016), as the shape I depend on: three states, no boolean helper.
 *
 * Returning the axis's own `why` matters — `regime.event_window` refusing because the calendar
 * cannot be shown to cover this frame's ±60 minutes is `calendar_unknown`, which must never be
 * reported as `EVENT_RISK`. A veto that fires because nobody is collecting is indistinguishable
 * from a busy news week exactly when the difference matters.
 */
export type AxisRead =
  | { status: 'ok'; value: number | string }
  | { status: 'unavailable'; why: 'calendar_unknown' | 'gate_axis_unavailable' | 'gate_key_unavailable' };

export type ReadRegimeAxis = (observable: string) => AxisRead;

/**
 * No regime axes wired yet.
 *
 * Returns `unavailable` rather than throwing or passing: until IB-016 lands, a gate on a regime
 * axis genuinely cannot be answered, and the honest consequence — the gated arm does not arm and
 * those closes leave the comparison — is exactly what should happen. Passing would arm on an
 * unverified premise; throwing would take the unconditional arm down with it.
 */
export const NO_REGIME_AXES: ReadRegimeAxis = () => ({ status: 'unavailable', why: 'gate_axis_unavailable' });

const REGIME_PREFIX = 'regime.';

export function evaluateContextGate(
  gate: ContextGate,
  frame: WebFeatureFrame,
  readAxis: ReadRegimeAxis = NO_REGIME_AXES,
): GateVerdict {
  const base = { observable: gate.observable, op: gate.op, value: gate.value };

  const read = gate.observable.startsWith(REGIME_PREFIX)
    ? readAxis(gate.observable)
    : readFeatureKey(frame, gate.observable);

  if (read.status === 'unavailable') {
    return { ...base, status: 'unavailable', actual: null, refusal: read.why };
  }

  return {
    ...base,
    actual: read.value,
    status: compare(read.value, gate.op, gate.value) ? 'pass' : 'blocked',
  };
}

/**
 * A feature key as a gate observable.
 *
 * A refused key is `gate_key_unavailable`, never a failed comparison. The difference decides
 * whether the close counts in the experiment, and silently treating a refusal as "did not pass"
 * is how a fortnight of missing liquidation history would become evidence against a gate.
 *
 * A key the registry does not have at all is also unavailable rather than an error: a config
 * naming a key that was removed by a frame version bump is an operational fact the gate should
 * fail closed on, not a crash that stops the pass for every symbol.
 */
function readFeatureKey(frame: WebFeatureFrame, key: string): AxisRead {
  const unavailable = { status: 'unavailable', why: 'gate_key_unavailable' } as const;
  const value = frame.keys[key];
  if (value === undefined || !value.ok) return unavailable;
  if (typeof value.value === 'boolean') return { status: 'ok', value: String(value.value) };
  if (typeof value.value === 'number' || typeof value.value === 'string') {
    return { status: 'ok', value: value.value };
  }
  // A composite value ({count, of}) has no ordering, so it cannot be compared by a gate.
  return unavailable;
}

/**
 * The comparison.
 *
 * A non-numeric value under an ordering operator does NOT pass: comparing a string with `<` in
 * JavaScript yields a lexicographic answer that looks like a number comparison and is not one.
 */
function compare(actual: number | string, op: ContextGate['op'], value: ContextGate['value']): boolean {
  if (op === 'in' || op === 'not_in') {
    const members = Array.isArray(value) ? value : [value];
    const present = members.some((member) => member === actual);
    return op === 'in' ? present : !present;
  }
  if (typeof actual !== 'number' || typeof value !== 'number') return false;
  switch (op) {
    case '<': return actual < value;
    case '<=': return actual <= value;
    case '>': return actual > value;
    case '>=': return actual >= value;
    default: return false;
  }
}
