import {
  activeConfig, contextGateForWrite, isRunnable, parseContextGate, statusForArm,
  type PlaybookConfigRow,
} from '../../src/playbooks/config';

const row = (version: number, status: 'live' | 'shadow' | 'off'): PlaybookConfigRow =>
  ({ playbook: 'P3', version, params: {}, status, contextGate: null });

describe('activeConfig', () => {
  it('takes the highest version', () => {
    expect(activeConfig([row(1, 'live'), row(3, 'shadow'), row(2, 'live')])?.version).toBe(3);
  });

  it('TURNING A PLAYBOOK OFF turns it off, rather than reverting to the previous version', () => {
    // A departure from the task's literal "highest version with status != off", flagged to the
    // Tech Lead. Read literally, an admin typing `/playbook P3 off` would watch the playbook
    // keep trading under v1's thresholds — the command appearing not to work, rather than
    // appearing to be a bug.
    const active = activeConfig([row(1, 'live'), row(2, 'off')]);
    expect(active?.version).toBe(2);
    expect(isRunnable(active)).toBe(false);
  });

  it('is null when a playbook has no configuration at all', () => {
    expect(activeConfig([])).toBeNull();
    expect(isRunnable(null)).toBe(false);
  });

  it('does not depend on row order', () => {
    expect(activeConfig([row(2, 'off'), row(1, 'live')])?.version).toBe(2);
  });
});

describe('statusForArm', () => {
  it('forces the unconditional arm to shadow even when the playbook is live', () => {
    // It is the control in an experiment. A control that could be delivered is not a control,
    // which is why this is hard-coded rather than configurable.
    expect(statusForArm(row(1, 'live'), 'unconditional')).toBe('shadow');
    expect(statusForArm(row(1, 'live'), 'gated')).toBe('live');
  });

  it('leaves a shadow playbook in shadow on both arms', () => {
    expect(statusForArm(row(1, 'shadow'), 'gated')).toBe('shadow');
    expect(statusForArm(row(1, 'shadow'), 'unconditional')).toBe('shadow');
  });
});

describe('parseContextGate', () => {
  it('accepts a gate with no gate', () => {
    expect(parseContextGate(null, 'P3')).toBeNull();
    expect(parseContextGate(undefined, 'P3')).toBeNull();
  });

  it('parses the §8.3 shape', () => {
    expect(parseContextGate({ observable: 'regime.trend', op: 'in', value: ['UP', 'RANGE'] }, 'P3'))
      .toEqual({ observable: 'regime.trend', op: 'in', value: ['UP', 'RANGE'] });
  });

  it('accepts `threshold` as well as `value`, because migration 001 spells it that way', () => {
    // §8.3 and the task say `value`; the migration's own comment says `threshold`. A seeded row
    // must not be rejected over a name.
    expect(parseContextGate({ observable: 'oi.d4h_pct', op: '<=', threshold: -8 }, 'P3')?.value).toBe(-8);
  });

  it('THROWS on two gates rather than silently taking one', () => {
    // §8.3's one-gate rule is structural. Ignoring a malformed gate would run a playbook the
    // operator believes is gated, and the twin-arm comparison would compare an arm with itself.
    expect(() => parseContextGate([{ observable: 'a', op: '<', value: 1 }], 'P3')).toThrow(/exactly one gate/);
  });

  it('THROWS on a missing right-hand side — a gate with no value is not a gate', () => {
    expect(() => parseContextGate({ observable: 'oi.d4h_pct', op: '<' }, 'P3')).toThrow(/value/);
  });

  it('THROWS on an unknown operator rather than defaulting to one', () => {
    expect(() => parseContextGate({ observable: 'x', op: '~=', value: 1 }, 'P3')).toThrow(/op must be one of/);
  });

  it('THROWS when the operator and the value disagree about arity', () => {
    // `in` with a scalar, or `<` with an array, is a config that cannot mean what it says.
    expect(() => parseContextGate({ observable: 'x', op: 'in', value: 'UP' }, 'P3')).toThrow(/disagree/);
    expect(() => parseContextGate({ observable: 'x', op: '<', value: [1, 2] }, 'P3')).toThrow(/disagree/);
  });

  it('names the playbook in every error, because a config error is operational', () => {
    expect(() => parseContextGate({ observable: '', op: '<', value: 1 }, 'P7')).toThrow(/^P7:/);
  });
});

describe('contextGateForWrite', () => {
  it('normalises to `value`, so the lenient read has a finite life', () => {
    // Ruled 2026-10-12: accept both spellings on read as a migration aid, write only the
    // canonical one. Otherwise in a year both live in the data and neither is authoritative.
    const parsed = parseContextGate({ observable: 'oi.d4h_pct', op: '<=', threshold: -8 }, 'P3');
    expect(contextGateForWrite(parsed!)).toEqual({ observable: 'oi.d4h_pct', op: '<=', value: -8 });
    expect(contextGateForWrite(parsed!)).not.toHaveProperty('threshold');
  });

  it('round-trips through the parser unchanged', () => {
    const gate = { observable: 'regime.trend', op: 'in' as const, value: ['UP', 'RANGE'] };
    expect(parseContextGate(contextGateForWrite(gate), 'P3')).toEqual(gate);
  });
});
