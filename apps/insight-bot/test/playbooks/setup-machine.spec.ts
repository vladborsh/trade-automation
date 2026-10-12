import type { GateVerdict } from '@trade-automation/contracts';
import { step, type MachineInput } from '../../src/playbooks/setup-machine';

/**
 * IB-017 — the setup state machine (§8.4).
 *
 * Each assertion pins a distinction the engine must not collapse, or an ORDERING that a
 * plausible implementation gets differently. The orderings matter more than they look: three of
 * them decide whether a setup fires on a bar we never looked at.
 */
const gate = (status: GateVerdict['status']): GateVerdict => (status === 'unavailable'
  ? { status, observable: 'regime.trend', op: 'in', value: ['UP'], actual: null, refusal: 'gate_axis_unavailable' }
  : { status, observable: 'regime.trend', op: 'in', value: ['UP'], actual: 'UP' });

const input = (over: Partial<MachineInput> = {}): MachineInput => ({
  arm: 'gated',
  prev: 'IDLE',
  verdict: { wantsArm: false, triggered: false, invalidated: false },
  gate: null,
  armKeysAvailable: true,
  triggerKeysAvailable: true,
  ttlReached: false,
  windowContiguous: true,
  cooldownActive: false,
  ...over,
});

const wantsArm = { wantsArm: true, triggered: false, invalidated: false };

describe('IDLE', () => {
  it('arms when the playbook wants to and nothing blocks it', () => {
    const out = step(input({ verdict: wantsArm }));
    expect(out.state).toBe('ARMED');
    expect(out.transitions).toEqual(['armed']);
  });

  it('stays IDLE with NO refusal when the playbook simply declined', () => {
    // "Evaluated and did not arm" is a statement about the market and must not carry a refusal.
    const out = step(input());
    expect(out.state).toBe('IDLE');
    expect(out.refusal).toBeNull();
  });

  it('REFUSES rather than declining when the arm keys are unavailable', () => {
    // The distinction the whole design rests on: a gap in our data is not a decision about the
    // market. On today's tape this is P3's normal state, for want of liquidation history.
    expect(step(input({ armKeysAvailable: false })).refusal).toBe('insufficient_features');
  });

  it('reports insufficient_features even when the playbook wanted to arm', () => {
    expect(step(input({ verdict: wantsArm, armKeysAvailable: false })).refusal)
      .toBe('insufficient_features');
  });

  it('does not arm during a cooldown, and that is not a refusal', () => {
    const out = step(input({ verdict: wantsArm, cooldownActive: true }));
    expect(out.state).toBe('IDLE');
    expect(out.refusal).toBeNull();
  });
});

/**
 * The gate is consulted ONLY here, on IDLE → ARMED. Arm-time only, so the gated arm stays a
 * clean subset of the unconditional one and any outcome difference is attributable to the gate
 * filtering entries rather than to it exiting early.
 */
describe('the context gate, at arm time only', () => {
  it('arms when the gate passes', () => {
    expect(step(input({ verdict: wantsArm, gate: gate('pass') })).state).toBe('ARMED');
  });

  it('does not arm when the gate is answered and BLOCKS — and keeps the close in the comparison', () => {
    // This is the gate doing its job. D10 tracks it, because the veto's own expectancy delta is
    // the experiment.
    const out = step(input({ verdict: wantsArm, gate: gate('blocked') }));
    expect(out.state).toBe('IDLE');
    expect(out.excludeFromComparison).toBe(false);
    expect(out.refusal).toBeNull();
  });

  it('EXCLUDES the close from the comparison when the gate cannot be answered', () => {
    // Otherwise our own outage reads as "the gate costs performance" — a number that is right
    // about the wrong population, in the one place where it decides whether a playbook ships.
    const out = step(input({ verdict: wantsArm, gate: gate('unavailable') }));
    expect(out.state).toBe('IDLE');
    expect(out.excludeFromComparison).toBe(true);
  });

  it('never consults the gate once ARMED', () => {
    // An armed setup follows its own invalidation rules. If the gate could also kill it, two
    // mechanisms would end setups and an author could not tell which did.
    const out = step(input({
      prev: 'ARMED', gate: gate('blocked'), verdict: { wantsArm: false, triggered: true, invalidated: false },
    }));
    expect(out.state).toBe('TRIGGERED');
  });
});

describe('ARMED', () => {
  const armed = (over: Partial<MachineInput> = {}) => step(input({ prev: 'ARMED', ...over }));

  it('triggers when the playbook says so', () => {
    const out = armed({ verdict: { wantsArm: false, triggered: true, invalidated: false } });
    expect(out.state).toBe('TRIGGERED');
    expect(out.transitions).toEqual(['triggered']);
  });

  it('expires honestly at the TTL when the window was intact', () => {
    const out = armed({ ttlReached: true });
    expect(out.transitions).toEqual(['expired']);
    expect(out.refusal).toBeNull(); // the market did not oblige; nothing is wrong with us
  });

  it('TRIGGERS on the final bar rather than expiring on it', () => {
    // The TTL is checked last on purpose: a trigger at the close that reaches the TTL is a
    // trigger, and ordering it the other way silently drops the last bar of every setup.
    const out = armed({ ttlReached: true, verdict: { wantsArm: false, triggered: true, invalidated: false } });
    expect(out.state).toBe('TRIGGERED');
  });

  it('INVALIDATION beats a trigger at the same close', () => {
    // The setup's own rules just said this is no longer the setup it was; firing would act on a
    // premise we withdrew in the same breath.
    const out = armed({ verdict: { wantsArm: false, triggered: true, invalidated: true } });
    expect(out.state).toBe('IDLE');
    expect(out.transitions).toEqual(['invalidated']);
  });

  it('a HOLE in the window beats a trigger, and that ordering is the point', () => {
    // The trigger may have fired in a bar we never evaluated. Firing now would stamp it with
    // this close and this price when it belongs to an earlier one.
    const out = armed({
      windowContiguous: false,
      verdict: { wantsArm: false, triggered: true, invalidated: false },
    });
    expect(out.state).toBe('IDLE');
    expect(out.transitions).toEqual(['expired_unevaluable']);
    expect(out.refusal).toBe('window_not_contiguous');
  });

  it('separates an unevaluable expiry from an honest one', () => {
    expect(armed({ ttlReached: true }).transitions).toEqual(['expired']);
    expect(armed({ windowContiguous: false }).transitions).toEqual(['expired_unevaluable']);
  });

  it('reports BLIND rather than waiting when a trigger key refuses', () => {
    // Checked before everything else: every judgement below it depends on being able to see.
    const out = armed({ triggerKeysAvailable: false });
    expect(out.state).toBe('ARMED');
    expect(out.refusal).toBe('blind_while_armed');
    expect(out.transitions).toEqual([]);
  });

  it('does not claim a trigger it cannot see, even if the playbook reports one', () => {
    // A playbook fed a refusing key could still return triggered: the machine must not take its
    // word for it when the inputs behind it are unavailable.
    const out = armed({
      triggerKeysAvailable: false,
      verdict: { wantsArm: false, triggered: true, invalidated: false },
    });
    expect(out.state).toBe('ARMED');
    expect(out.refusal).toBe('blind_while_armed');
  });

  it('stays ARMED when nothing happened', () => {
    expect(armed().state).toBe('ARMED');
  });
});

describe('TRIGGERED', () => {
  it('is frozen until IB-023 records an outcome — no invented timeout', () => {
    // A timeout here would be a fabricated number. The stuck count exists to justify a real one
    // later; the absence is a decision.
    for (const over of [{ ttlReached: true }, { windowContiguous: false }, { cooldownActive: true }]) {
      expect(step(input({ prev: 'TRIGGERED', ...over })).state).toBe('TRIGGERED');
    }
  });
});

describe('CLOSED', () => {
  it('returns to IDLE once the cooldown has lapsed', () => {
    expect(step(input({ prev: 'CLOSED' })).state).toBe('IDLE');
  });

  it('stays CLOSED while the cooldown blocks a new arm', () => {
    expect(step(input({ prev: 'CLOSED', cooldownActive: true })).state).toBe('CLOSED');
  });
});

describe('totality', () => {
  it('yields a state for every combination of the boolean inputs', () => {
    // Deterministic and total: a machine that can fall through is a machine that silently keeps
    // whatever state it had.
    const bools = [true, false];
    let n = 0;
    for (const prev of ['IDLE', 'ARMED', 'TRIGGERED', 'CLOSED'] as const) {
      for (const triggered of bools) for (const invalidated of bools) {
        for (const armKeysAvailable of bools) for (const triggerKeysAvailable of bools) {
          for (const ttlReached of bools) for (const windowContiguous of bools) {
            for (const cooldownActive of bools) {
              const out = step(input({
                prev, verdict: { wantsArm: true, triggered, invalidated },
                armKeysAvailable, triggerKeysAvailable, ttlReached, windowContiguous, cooldownActive,
              }));
              expect(['IDLE', 'ARMED', 'TRIGGERED', 'CLOSED']).toContain(out.state);
              n += 1;
            }
          }
        }
      }
    }
    expect(n).toBe(4 * 2 ** 7);
  });
});
