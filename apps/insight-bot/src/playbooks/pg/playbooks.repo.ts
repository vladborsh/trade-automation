import type { Arm, SetupState } from '@trade-automation/contracts';
import type { DbHandle } from '../../db/db.port';
import { parseContextGate, type PlaybookConfigRow, type PlaybookStatus } from '../config';

/**
 * IB-017 — the playbook engine's reads and writes. SQL under a `pg/` directory (IB-004).
 *
 * **`source_mode` is in every key here, not merely on every row.** §8.4 makes the backtest
 * runner the same function over historical frames, so each of these tables has two writers
 * producing rows about the same instants. `playbook_state` is the sharpest case: keyed only by
 * `(playbook, symbol, arm)` a backtest would not add a duplicate, it would OVERWRITE what the
 * live engine is currently holding.
 */

export type SourceMode = 'live' | 'backtest';

const asDate = (ms: number) => new Date(ms);
const sec = (d: Date) => Math.floor(new Date(d).getTime() / 1000);

/** Every configuration version of every playbook. `activeConfig` picks; this does not. */
export async function playbookConfigs(db: DbHandle): Promise<PlaybookConfigRow[]> {
  const rows = await db.query<{
    playbook: string; version: number; params: Record<string, unknown>;
    status: PlaybookStatus; context_gate: unknown;
  }>(
    `select playbook, version, params, status, context_gate from playbook_config
      order by playbook, version`,
  );
  return rows.map((r) => ({
    playbook: r.playbook,
    version: r.version,
    params: r.params,
    status: r.status,
    // Throws on a malformed or two-gate value rather than ignoring it: a gate that is present
    // in the config and has no effect turns the twin-arm comparison into a null result.
    contextGate: parseContextGate(r.context_gate, r.playbook),
  }));
}

export interface StoredState {
  state: SetupState;
  version: number;
  setup: unknown;
  armedAtMs: number | null;
  expiresAtMs: number | null;
}

/** The current state of every arm of one playbook, keyed `symbol|arm`. */
export async function statesFor(
  db: DbHandle,
  playbook: string,
  sourceMode: SourceMode,
): Promise<Map<string, StoredState>> {
  const rows = await db.query<{
    symbol: string; arm: Arm; state: SetupState; version: number;
    setup: unknown; armed_at: Date | null; expires_at: Date | null;
  }>(
    `select symbol, arm, state, version, setup, armed_at, expires_at
       from playbook_state where playbook = $1 and source_mode = $2`,
    [playbook, sourceMode],
  );
  return new Map(rows.map((r) => [`${r.symbol}|${r.arm}`, {
    state: r.state,
    version: r.version,
    setup: r.setup,
    armedAtMs: r.armed_at === null ? null : new Date(r.armed_at).getTime(),
    expiresAtMs: r.expires_at === null ? null : new Date(r.expires_at).getTime(),
  }]));
}

export async function writeState(
  db: DbHandle,
  row: {
    playbook: string; symbol: string; arm: Arm; sourceMode: SourceMode;
    state: SetupState; version: number; setup: unknown;
    armedAtMs: number | null; expiresAtMs: number | null;
  },
): Promise<void> {
  await db.query(
    `insert into playbook_state
       (playbook, symbol, arm, source_mode, state, version, setup, armed_at, expires_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9, now())
     on conflict (playbook, symbol, arm, source_mode) do update
        set state = excluded.state, version = excluded.version, setup = excluded.setup,
            armed_at = excluded.armed_at, expires_at = excluded.expires_at, updated_at = now()`,
    [row.playbook, row.symbol, row.arm, row.sourceMode, row.state, row.version,
      row.setup === null ? null : JSON.stringify(row.setup),
      row.armedAtMs === null ? null : asDate(row.armedAtMs),
      row.expiresAtMs === null ? null : asDate(row.expiresAtMs)],
  );
}

export interface EvaluationRow {
  playbook: string;
  version: number;
  symbol: string;
  arm: Arm;
  sourceMode: SourceMode;
  closeTimeMs: number;
  outcome: 'armed' | 'triggered' | 'invalidated' | 'expired' | 'expired_unevaluable' | 'declined' | 'refused' | 'held';
  refusal: string | null;
  gateStatus: 'pass' | 'blocked' | 'unavailable' | null;
  gateRefusal: string | null;
  excludeFromComparison: boolean;
  /**
   * The frame revision this arm actually read.
   *
   * On the row because without it nobody can tell afterwards whether the two arms of a close
   * were compared on the same information — and the case where they are not is invisible in
   * every other column.
   */
  frameRevision: number;
}

/**
 * Appends the per-close audit row.
 *
 * `on conflict do nothing`, and the boolean it returns is the runner's **idempotency gate**: a
 * close already recorded is not re-evaluated. That matters more here than for frames, because
 * the state machine is stateful — a naive re-run would read the state the first run left behind
 * and advance it again, so "run it twice over the same frames" would not be a no-op but a
 * different answer. Re-running must be safe; it is how a backfill is finished after an
 * interruption.
 */
export async function recordEvaluation(db: DbHandle, row: EvaluationRow): Promise<boolean> {
  const rows = await db.query<{ playbook: string }>(
    `insert into playbook_evaluations
       (playbook, version, symbol, arm, source_mode, close_time, outcome, refusal,
        gate_status, gate_refusal, exclude_from_comparison, frame_revision)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (playbook, symbol, arm, close_time, source_mode) do nothing
     returning playbook`,
    [row.playbook, row.version, row.symbol, row.arm, row.sourceMode, asDate(row.closeTimeMs),
      row.outcome, row.refusal, row.gateStatus, row.gateRefusal, row.excludeFromComparison,
      row.frameRevision],
  );
  return rows.length > 0;
}

/**
 * The frame revision already pinned for this close, by whichever arm touched it first.
 *
 * Across ARMS deliberately — the pin is a property of `(playbook, symbol, close_time)`, not of
 * one arm. That is the whole point: the two arms of a close must be compared on the same
 * information, and the hazard is precisely that one of them is evaluated later, after a heal
 * pass has produced a better-informed revision.
 *
 * Null when nothing has touched this close yet, in which case the caller's frame sets the pin.
 */
export async function pinnedFrameRevision(
  db: DbHandle,
  q: { playbook: string; symbol: string; sourceMode: SourceMode; closeTimeMs: number },
): Promise<number | null> {
  const rows = await db.query<{ frame_revision: number }>(
    `select frame_revision from playbook_evaluations
      where playbook = $1 and symbol = $2 and source_mode = $3 and close_time = $4
      order by frame_revision
      limit 1`,
    [q.playbook, q.symbol, q.sourceMode, asDate(q.closeTimeMs)],
  );
  return rows[0]?.frame_revision ?? null;
}

/** Has this close already been evaluated for this arm? The idempotency question, asked first. */
export async function alreadyEvaluated(
  db: DbHandle,
  q: { playbook: string; symbol: string; arm: Arm; sourceMode: SourceMode; closeTimeMs: number },
): Promise<boolean> {
  const rows = await db.query<{ one: number }>(
    `select 1 as one from playbook_evaluations
      where playbook = $1 and symbol = $2 and arm = $3 and source_mode = $4 and close_time = $5`,
    [q.playbook, q.symbol, q.arm, q.sourceMode, asDate(q.closeTimeMs)],
  );
  return rows.length > 0;
}

/**
 * The closes this arm actually evaluated and could ACT on, within a window.
 *
 * `blind_while_armed` is excluded deliberately: we looked and could not tell, which is not the
 * same as having evaluated the close. `insufficient_features` is included, because it concerns
 * the arm keys and says nothing about whether the trigger was visible.
 */
export async function evaluatedCloses(
  db: DbHandle,
  q: { playbook: string; symbol: string; arm: Arm; sourceMode: SourceMode; fromMs: number; toMs: number },
): Promise<Set<number>> {
  const rows = await db.query<{ close_time: Date }>(
    `select close_time from playbook_evaluations
      where playbook = $1 and symbol = $2 and arm = $3 and source_mode = $4
        and close_time > $5 and close_time <= $6
        and (refusal is null or refusal <> 'blind_while_armed')`,
    [q.playbook, q.symbol, q.arm, q.sourceMode, asDate(q.fromMs), asDate(q.toMs)],
  );
  return new Set(rows.map((r) => new Date(r.close_time).getTime()));
}

/** Cooldowns in force at an instant, as a set of `playbook|symbol`. */
export async function activeCooldowns(
  db: DbHandle,
  atMs: number,
  sourceMode: SourceMode,
): Promise<Set<string>> {
  const rows = await db.query<{ playbook: string; symbol: string }>(
    `select playbook, symbol from cooldowns where source_mode = $1 and until > $2`,
    [sourceMode, asDate(atMs)],
  );
  return new Set(rows.map((r) => `${r.playbook}|${r.symbol}`));
}

export interface SignalRow {
  id: string;
  playbook: string;
  version: number;
  arm: Arm;
  sourceMode: SourceMode;
  symbol: string;
  direction: 'long' | 'short';
  /** The BAR CLOSE the trigger fired at — D12's anchor, never the moment we noticed. */
  triggerCloseTimeMs: number;
  detectedAtMs: number;
  detectionSkewSec: number;
  tf: string;
  setup: unknown;
  featureSnapshot: unknown;
  regime: unknown;
  statusAtSignal: string;
  expiresAtMs: number | null;
}

/**
 * Inserts a signal, idempotent on D12's key plus the mode.
 *
 * Returns false when the row already existed — a replay of the same bar, however late, is not a
 * second signal.
 */
export async function insertSignal(db: DbHandle, row: SignalRow): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `insert into signals
       (id, playbook, version, arm, source_mode, symbol, direction, trigger_ts, detected_at,
        detection_skew_sec, tf, setup, feature_snapshot, regime, status_at_signal, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16)
     on conflict (playbook, symbol, trigger_ts, arm, source_mode) do nothing
     returning id`,
    [row.id, row.playbook, row.version, row.arm, row.sourceMode, row.symbol, row.direction,
      asDate(row.triggerCloseTimeMs), asDate(row.detectedAtMs), row.detectionSkewSec, row.tf,
      JSON.stringify(row.setup), JSON.stringify(row.featureSnapshot),
      row.regime === null || row.regime === undefined ? null : JSON.stringify(row.regime),
      row.statusAtSignal, row.expiresAtMs === null ? null : asDate(row.expiresAtMs)],
  );
  return rows.length > 0;
}

/**
 * Setups stuck in TRIGGERED, per playbook.
 *
 * `TRIGGERED → CLOSED` belongs to the tracker (IB-023), which does not exist yet, so nothing
 * leaves TRIGGERED today. **This count exists TO justify a future timeout** rather than to
 * excuse the absence of one: a timeout invented now would be a fabricated number, and this is
 * the measurement that would later set it. Reported, never acted on.
 */
export async function stuckTriggered(
  db: DbHandle,
  sourceMode: SourceMode,
): Promise<Array<{ playbook: string; symbol: string; arm: Arm; sinceMs: number }>> {
  const rows = await db.query<{ playbook: string; symbol: string; arm: Arm; updated_at: Date }>(
    `select playbook, symbol, arm, updated_at from playbook_state
      where state = 'TRIGGERED' and source_mode = $1
      order by updated_at`,
    [sourceMode],
  );
  return rows.map((r) => ({
    playbook: r.playbook, symbol: r.symbol, arm: r.arm, sinceMs: sec(r.updated_at) * 1000,
  }));
}
