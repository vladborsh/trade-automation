import {
  ArmRefusalSchema, ArmSchema, GateRefusalSchema, GateVerdictSchema, SetupSchema,
  SetupStateSchema, SetupTransitionSchema, SignalSourceModeSchema, TriggerTimingSchema,
  detectionSkewSec, endsWithoutOutcome, gateWasAnswered, isLateDetection,
} from '../src/insight/playbook';

/**
 * IB-017 — the playbook port and the twin-arm contract.
 *
 * What is asserted here is the set of distinctions the engine must not be able to collapse.
 * Every one of them is a place where two different facts would otherwise share a field or a
 * counter, which is the defect shape this product has spent the week removing.
 */

describe('the states and transitions', () => {
  it('carries the four states of §8.4 and no others', () => {
    expect(SetupStateSchema.options).toEqual(['IDLE', 'ARMED', 'TRIGGERED', 'CLOSED']);
  });

  it('separates an honest expiry from an unevaluable one', () => {
    // The market not obliging and us not looking are different events. A single `expired`
    // would make a feature-pass outage read as a quiet fortnight.
    expect(SetupTransitionSchema.options).toContain('expired');
    expect(SetupTransitionSchema.options).toContain('expired_unevaluable');
  });

  it('counts both as ending a setup without anyone learning anything', () => {
    expect(endsWithoutOutcome('expired')).toBe(true);
    expect(endsWithoutOutcome('expired_unevaluable')).toBe(true);
    expect(endsWithoutOutcome('invalidated')).toBe(true);
  });

  it('does NOT treat a trigger or a close as outcome-less', () => {
    // `triggered` produces a signal and `closed` has an outcome behind it; folding either into
    // the outcome-less bucket would understate how often the engine actually decided something.
    expect(endsWithoutOutcome('triggered')).toBe(false);
    expect(endsWithoutOutcome('closed')).toBe(false);
    expect(endsWithoutOutcome('armed')).toBe(false);
  });
});

describe('the two arms', () => {
  it('is exactly gated and unconditional', () => {
    expect(ArmSchema.options).toEqual(['gated', 'unconditional']);
  });
});

/**
 * The gate's verdict carries WHY it did not pass, and the distinction decides whether a
 * playbook ships.
 */
describe('GateVerdict', () => {
  const base = { observable: 'regime.trend', op: 'in', value: ['UP', 'RANGE'] };
  const blocked = () => GateVerdictSchema.parse({ ...base, status: 'blocked', actual: 'DOWN' });
  const unavailable = () => GateVerdictSchema.parse({
    ...base, status: 'unavailable', actual: null, refusal: 'gate_axis_unavailable',
  });

  it('distinguishes "answered and said no" from "could not be answered"', () => {
    // Ruled 2026-10-12: the gated arm failing to arm because an axis was unavailable must be
    // counted apart from the gate genuinely not passing, or the twin-arm comparison reads "the
    // gate costs performance" when the truth is "we were blind for part of the window".
    expect(blocked().status).toBe('blocked');
    expect(unavailable().status).toBe('unavailable');
  });

  it('makes "not passing" unrepresentable without saying WHY — a union, not a boolean', () => {
    // dev-1's evaluateRegimeGate exposes no boolean helper for the same reason: with
    // `pass: false` and a nullable reason beside it, a caller reads the boolean and never looks
    // at the field saying the gate could not be answered at all.
    expect(() => GateVerdictSchema.parse({ ...base, status: 'unavailable', actual: null })).toThrow();
    expect(GateVerdictSchema.options).toHaveLength(3);
  });

  it('forces a null actual on the unavailable branch', () => {
    // An observable that could not be read has no value. Letting one be recorded would invite a
    // reader to use it.
    expect(() => GateVerdictSchema.parse({
      ...base, status: 'unavailable', actual: 'UP', refusal: 'gate_axis_unavailable',
    })).toThrow();
  });

  it('gateWasAnswered is the filter the twin-arm comparison runs FIRST', () => {
    // A close where the gate was unavailable is evidence about our plumbing, not the market, and
    // must be dropped from BOTH arms before they are compared.
    expect(gateWasAnswered(blocked())).toBe(true);
    expect(gateWasAnswered(unavailable())).toBe(false);
  });

  it('never reports an unanswerable calendar as EVENT_RISK', () => {
    // A veto that fires because nobody is collecting is indistinguishable from a busy news week
    // exactly when the difference matters. Measured: 256 calendar rows, last fetch nine days
    // earlier, would have read CLEAR throughout on a non-emptiness check.
    expect(GateRefusalSchema.options).toContain('calendar_unknown');
    expect(GateRefusalSchema.options).not.toContain('EVENT_RISK');
  });

  it('covers a feature-key gate and the calendar, not just a regime axis', () => {
    for (const refusal of ['gate_key_unavailable', 'calendar_unknown'] as const) {
      expect(() => GateVerdictSchema.parse({
        ...base, status: 'unavailable', actual: null, refusal,
      })).not.toThrow();
    }
  });
});

describe('ArmRefusal — refusing to decide is not deciding not to arm', () => {
  it('names the ways the engine does not produce a signal, each counted apart', () => {
    expect(ArmRefusalSchema.options).toEqual([
      'insufficient_features', 'blind_while_armed', 'window_not_contiguous', 'late_detection',
      'frame_revision_unavailable',
    ]);
  });

  it('keeps frame_revision_unavailable distinct from a missing input', () => {
    // The frame exists; a SIBLING ARM pinned a different revision of it and that one cannot be
    // read. Refusing loudly beats substituting the newest, which is the lookahead the pin
    // exists to prevent — the two arms of a close must be compared on the same information.
    expect(ArmRefusalSchema.options).toContain('frame_revision_unavailable');
  });

  it('keeps late_detection distinct, because it is NOT a gap in the data', () => {
    // The evaluation succeeded and the trigger fired; we noticed too late to act. A rising
    // count means the pass is running late — a fact about us, not about the market, and not
    // the same fact as a missing input.
    expect(ArmRefusalSchema.options).toContain('late_detection');
    expect(ArmRefusalSchema.options.indexOf('late_detection'))
      .toBeGreaterThan(ArmRefusalSchema.options.indexOf('insufficient_features'));
  });

  it('keeps blind_while_armed as its own state rather than a pause', () => {
    // Holding a live setup while a trigger key refuses is the condition under which a user would
    // most want to know the system is impaired. Silently waiting reports nothing.
    expect(ArmRefusalSchema.options).toContain('blind_while_armed');
  });
});

/**
 * Two facts, two fields. Stamping a trigger with the moment we evaluated it rather than the bar
 * it fired on carries today's price into a decision that belongs to an earlier one.
 */
describe('TriggerTiming', () => {
  const CLOSE = 1_760_000_000;
  const timing = (detectedAt: number) => TriggerTimingSchema.parse({
    triggerCloseTime: CLOSE,
    detectedAt,
    detectionSkewSec: detectionSkewSec(CLOSE, detectedAt),
  });

  it('records when it fired separately from when we saw it', () => {
    const t = timing(CLOSE + 2700);
    expect(t.triggerCloseTime).toBe(CLOSE);
    expect(t.detectedAt).toBe(CLOSE + 2700);
    expect(t.detectionSkewSec).toBe(2700);
  });

  it('is signed, so a clock problem can be REPORTED rather than clamped', () => {
    // A negative skew is not "early", it is evidence of a clock step. A field that cannot hold
    // it cannot report it, and the condition would surface as impossible data instead.
    expect(timing(CLOSE - 60).detectionSkewSec).toBe(-60);
  });

  it('calls a skew past the bound a LATE DETECTION, not a signal', () => {
    expect(isLateDetection(timing(CLOSE + 100), 300)).toBe(false);
    expect(isLateDetection(timing(CLOSE + 900), 300)).toBe(true);
  });

  it('treats the bound as a parameter, not a property of the data', () => {
    // The same trigger is actionable under one config and stale under another: how old a
    // trigger may be is a product decision, and it belongs in playbook_config where changing it
    // creates a version.
    const t = timing(CLOSE + 600);
    expect(isLateDetection(t, 1200)).toBe(false);
    expect(isLateDetection(t, 300)).toBe(true);
  });

  it('is exactly at the bound and not over it', () => {
    expect(isLateDetection(timing(CLOSE + 300), 300)).toBe(false);
  });
});

describe('SignalSourceMode', () => {
  it('distinguishes a live signal from a backtested one', () => {
    // Without it, D12's key (playbook, symbol, trigger_ts, arm) makes an `on conflict do
    // nothing` silently drop whichever of the two ran second — and a backtest that drops its own
    // rows exactly where live signals exist reports BETTER-than-real performance.
    expect(SignalSourceModeSchema.options).toEqual(['live', 'backtest']);
  });
});

describe('Setup', () => {
  const setup = {
    armId: 'a1', direction: 'long' as const,
    trigger: { type: 'close_above', level: 84000, tf: '15m' as const },
    stop: 83000, targets: [85000, 86000],
    invalidation: [{ key: 'px.close', op: '<' as const, value: 83000 }],
    rr: 2.5, expiresAt: 1_760_007_200,
  };

  it('keeps invalidation MACHINE-readable, so the tracker never parses prose', () => {
    expect(SetupSchema.parse(setup).invalidation[0]).toEqual({ key: 'px.close', op: '<', value: 83000 });
  });

  it('allows a null rr rather than inventing one when targets cannot be priced', () => {
    expect(SetupSchema.parse({ ...setup, rr: null }).rr).toBeNull();
  });

  it('requires an expiry, because an ARMED setup with no TTL never expires', () => {
    const { expiresAt: _omitted, ...withoutExpiry } = setup;
    expect(() => SetupSchema.parse(withoutExpiry)).toThrow();
  });
});
