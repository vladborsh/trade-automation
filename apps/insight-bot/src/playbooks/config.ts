/**
 * IB-017 — which version of a playbook's configuration is in force, and what its one declared
 * context gate says.
 *
 * Pure. The runner reads the rows; everything about what they MEAN is decided here and spec'd
 * without a database.
 */

export type PlaybookStatus = 'live' | 'shadow' | 'off';

/** §8.3: at most ONE gate per playbook, over a regime axis or a single feature key. */
export interface ContextGate {
  observable: string;
  op: '<' | '<=' | '>' | '>=' | 'in' | 'not_in';
  value: number | string | Array<number | string>;
}

export interface PlaybookConfigRow {
  playbook: string;
  version: number;
  params: Record<string, unknown>;
  status: PlaybookStatus;
  contextGate: ContextGate | null;
}

/**
 * The configuration in force for a playbook.
 *
 * **The highest version wins, full stop — including when its status is `off`.**
 *
 * The task's wording is "active = highest version with status ≠ off", and read literally that
 * means the highest version *among the non-off ones*, so turning a playbook off would fall back
 * to the previous version and silently re-activate it. An admin typing `/playbook P3 off` would
 * see the playbook keep trading under older thresholds, which is the worst possible response to
 * that command and would present as the command not working rather than as a bug.
 *
 * So: the newest version is the configuration, and `off` means off. Ruled 2026-10-12 as a
 * **safety fix rather than a semantics preference**: under the literal reading, `off` is a
 * revert switch, so an admin killing a playbook during a problem watches it keep trading on
 * older thresholds and concludes the command is broken. A kill switch that appears not to work
 * is worse than no kill switch.
 *
 * **The corollary, also ruled: a revert is an explicit new version carrying the old values,
 * never an implicit fallback.** Going back to v1's thresholds means writing them as v3. That
 * keeps `playbook_config` a complete history of what was in force when — which is what every
 * stored signal's `version` is a reference into — instead of a stack whose top can be popped.
 */
export function activeConfig(rows: readonly PlaybookConfigRow[]): PlaybookConfigRow | null {
  let best: PlaybookConfigRow | null = null;
  for (const row of rows) {
    if (best === null || row.version > best.version) best = row;
  }
  return best;
}

/** Is this playbook allowed to run at all? `off` is not evaluated, not even in shadow. */
export function isRunnable(config: PlaybookConfigRow | null): boolean {
  return config !== null && config.status !== 'off';
}

/**
 * The status a signal from this arm is recorded under.
 *
 * The `unconditional` arm is **always** shadow regardless of configuration (§8.3, D9): it is the
 * control in an experiment, and a control that could be delivered is not a control. Hard-coded
 * rather than configured for exactly that reason — a config key here would be a way to break the
 * experiment by accident.
 */
export function statusForArm(config: PlaybookConfigRow, arm: 'gated' | 'unconditional'): PlaybookStatus {
  return arm === 'unconditional' ? 'shadow' : config.status;
}

/**
 * Parses `playbook_config.context_gate`, refusing anything that is not exactly one gate.
 *
 * **Read-side leniency, with an expiry.** `value` is the canonical spelling — §8.3 and the task
 * both use it, and a migration comment is the weakest of the three sources — but migration
 * 001's comment says `threshold`, so a hand-seeded row may carry either. Both are accepted HERE
 * and only here; everything written goes through `contextGateForWrite`, which emits `value`.
 *
 * This branch is a **migration aid and is meant to be deleted**: once
 * `select count(*) from playbook_config where context_gate ? 'threshold'` returns 0, remove the
 * fallback and this paragraph. Left in place indefinitely it stops being leniency and becomes a
 * second canonical spelling, and in a year neither is authoritative.
 *
 * §8.3 is structural, not advisory: "no playbook may declare two gates". A malformed or
 * multi-gate value THROWS rather than being ignored, because ignoring it would run a playbook
 * the operator believes is gated — the gate would appear in the config, produce no effect, and
 * the twin-arm comparison would silently compare an arm against itself.
 */
export function parseContextGate(raw: unknown, playbook: string): ContextGate | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) {
    throw new Error(
      `${playbook}: context_gate is an array. §8.3 allows exactly one gate per playbook; two ` +
      'gates cannot be expressed and must not be silently reduced to one.',
    );
  }
  if (typeof raw !== 'object') {
    throw new Error(`${playbook}: context_gate must be an object, got ${typeof raw}`);
  }
  const gate = raw as Record<string, unknown>;
  const observable = gate['observable'];
  const op = gate['op'];
  const value = 'value' in gate ? gate['value'] : gate['threshold'];

  if (typeof observable !== 'string' || observable.length === 0) {
    throw new Error(`${playbook}: context_gate.observable must be a non-empty string`);
  }
  if (!isOp(op)) {
    throw new Error(`${playbook}: context_gate.op must be one of ${OPS.join(', ')}, got ${String(op)}`);
  }
  if (value === undefined) {
    throw new Error(`${playbook}: context_gate needs a value (or threshold)`);
  }
  if ((op === 'in' || op === 'not_in') !== Array.isArray(value)) {
    throw new Error(
      `${playbook}: context_gate op "${op}" and value disagree — "in"/"not_in" take an array ` +
      'and the comparison operators take a scalar.',
    );
  }
  return { observable, op, value: value as ContextGate['value'] };
}

/**
 * The canonical shape to persist: always `value`, never `threshold`.
 *
 * Every writer goes through this, so the lenient read above has a finite life rather than
 * quietly licensing both spellings for ever.
 */
export function contextGateForWrite(gate: ContextGate): Record<string, unknown> {
  return { observable: gate.observable, op: gate.op, value: gate.value };
}

const OPS = ['<', '<=', '>', '>=', 'in', 'not_in'] as const;
function isOp(op: unknown): op is ContextGate['op'] {
  return typeof op === 'string' && (OPS as readonly string[]).includes(op);
}
