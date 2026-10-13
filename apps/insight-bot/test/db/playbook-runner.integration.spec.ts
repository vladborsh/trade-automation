import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { featureSpecFingerprint, type WebFeatureFrame } from '@trade-automation/contracts';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import type { Playbook } from '../../src/playbooks/playbook.port';
import { PlaybookRunner } from '../../src/playbooks/runner.service';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-017 — the runner, against a real database, with a fixture playbook.
 *
 * This is where composition lives, and today's defects have all been composition failures. The
 * fixture is deliberately trivial — arm above 100, trigger above 110, invalidate below 90 — so
 * that every assertion below is about the ENGINE rather than about a strategy.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('playbook-runner.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const M15 = 15 * 60_000;
const T0 = Date.UTC(2026, 9, 12, 12, 0, 0);
const SYMBOL = 'BTCUSDT';

const frameAt = (closeMs: number, close: number): WebFeatureFrame => ({
  symbol: SYMBOL, tf: '15m', closeTime: Math.floor(closeMs / 1000), frameVersion: 1,
  keys: { 'px.close': { ok: true, value: close } },
  basis: { venues: [], coverage: 'not_recorded', coveredHours: null },
  complete: false, incompleteReason: [], revision: 1, amendedAt: null, amendedKeys: [],
  computedMode: 'live', computedAt: Math.floor(closeMs / 1000),
  specFingerprint: featureSpecFingerprint(),
});

/** A frame whose only key refuses — the "cannot see" case. */
const blindFrame = (closeMs: number): WebFeatureFrame => ({
  ...frameAt(closeMs, 0),
  keys: { 'px.close': { ok: false, why: 'no_data' } },
});

const FIXTURE: Playbook = {
  id: 'PTEST',
  tf: '15m',
  keys: { armKeys: ['px.close'], triggerKeys: ['px.close'] },
  evaluate: (input) => {
    const value = input.frame.keys['px.close'];
    const price = value?.ok === true && typeof value.value === 'number' ? value.value : null;
    if (price === null) return { wantsArm: false, triggered: false, invalidated: false, conditions: [] };
    return {
      wantsArm: input.prev === 'IDLE' && price >= 100,
      triggered: input.prev === 'ARMED' && price >= 110,
      invalidated: input.prev === 'ARMED' && price < 90,
      setup: {
        armId: 'fixture', direction: 'long',
        trigger: { type: 'close_above', level: 110, tf: '15m' },
        stop: 95, targets: [120], invalidation: [], rr: 2,
        expiresAt: Math.floor((input.closeTime + 8 * M15) / 1000),
      },
      conditions: [{ key: 'px.close', value: price, threshold: 100, pass: price >= 100 }],
    };
  },
};

maybeDescribe('IB-017 the runner', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let runner: PlaybookRunner;

  const registry = new Map([[FIXTURE.id, FIXTURE]]);

  const setConfig = async (version: number, status: string, gate: unknown = null, params: unknown = {}) =>
    db.query(
      `insert into playbook_config (playbook, version, params, status, context_gate, created_by)
       values ($1,$2,$3::jsonb,$4,$5::jsonb,'spec')
       on conflict (playbook, version) do update set status = excluded.status,
         context_gate = excluded.context_gate, params = excluded.params`,
      [FIXTURE.id, version, JSON.stringify(params), status, gate === null ? null : JSON.stringify(gate)],
    );

  const run = (closeMs: number, price: number, nowMs = closeMs + 15_000) =>
    runner.runClose('15m', closeMs, nowMs, [SYMBOL], new Map([[SYMBOL, frameAt(closeMs, price)]]), 'live');

  const reset = async () => {
    // feature_frames too: the pinning tests seed revisions here, and a row surviving into the
    // next test makes an unsatisfiable pin satisfiable. Caught by this suite failing in a full
    // run while passing alone — the ordering dependency was in the fixture, not the code.
    await db.query(`delete from feature_frames`);
    await db.query(`delete from playbook_evaluations`);
    await db.query(`delete from signals`);
    await db.query(`delete from playbook_state`);
    await db.query(`delete from cooldowns`);
    await db.query(`delete from playbook_config`);
    await setConfig(1, 'live');
  };

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_run', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db)
      .ensureRange(new Date(T0 - 40 * 86_400_000), new Date(T0 + 40 * 86_400_000));
    runner = new PlaybookRunner({ db, registry });
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  beforeEach(reset);

  const states = async () => db.query<{ arm: string; state: string }>(
    `select arm, state from playbook_state order by arm`);
  const evaluations = async () => db.query<{ arm: string; outcome: string; refusal: string | null }>(
    `select arm, outcome, refusal from playbook_evaluations order by close_time, arm`);

  describe('the state transitions', () => {
    it('arms both arms, then triggers both, writing one signal each', async () => {
      await run(T0, 105);
      expect(await states()).toEqual([
        { arm: 'gated', state: 'ARMED' }, { arm: 'unconditional', state: 'ARMED' },
      ]);

      const summary = await run(T0 + M15, 115);
      expect(summary.triggered).toBe(2);
      expect(summary.signals).toBe(2);
      const rows = await db.query<{ arm: string; trigger_ts: Date }>(
        `select arm, trigger_ts from signals order by arm`);
      expect(rows.map((r) => r.arm)).toEqual(['gated', 'unconditional']);
      // The signal is stamped with the BAR, not with when we evaluated it.
      expect(new Date(rows[0]!.trigger_ts).getTime()).toBe(T0 + M15);
    });

    it('INVALIDATES back to IDLE and writes no signal', async () => {
      await run(T0, 105);
      const summary = await run(T0 + M15, 80);
      expect(summary.signals).toBe(0);
      expect((await states()).every((s) => s.state === 'IDLE')).toBe(true);
      expect((await evaluations()).slice(2).every((e) => e.outcome === 'invalidated')).toBe(true);
    });

    it('EXPIRES honestly at the TTL with the window intact', async () => {
      await setConfig(1, 'live', null, { armed_ttl_bars: 2 });
      await run(T0, 105);
      await run(T0 + M15, 101);        // held, no trigger
      const summary = await run(T0 + 2 * M15, 101); // TTL reached
      expect(summary.signals).toBe(0);
      const last = (await evaluations()).slice(-2);
      expect(last.map((e) => e.outcome)).toEqual(['expired', 'expired']);
      expect(last.every((e) => e.refusal === null)).toBe(true); // the market, not us
    });
  });

  describe('the armed window', () => {
    it('EXPIRES UNEVALUABLE when a close was never evaluated, even though it triggered', async () => {
      // The defect this prevents: the trigger may have fired in the bar we skipped, so firing
      // now would stamp it with this close and this price when it belongs to an earlier one.
      await setConfig(1, 'live', null, { armed_ttl_bars: 8 });
      await run(T0, 105);
      // T0 + M15 is deliberately NOT run — the pass was down for that bar.
      const summary = await run(T0 + 2 * M15, 115);
      expect(summary.signals).toBe(0);
      const last = (await evaluations()).slice(-2);
      expect(last.map((e) => e.outcome)).toEqual(['expired_unevaluable', 'expired_unevaluable']);
      expect(last.every((e) => e.refusal === 'window_not_contiguous')).toBe(true);
    });

    it('is BLIND rather than waiting when the trigger key refuses', async () => {
      await run(T0, 105);
      const summary = await runner.runClose(
        '15m', T0 + M15, T0 + M15 + 15_000, [SYMBOL],
        new Map([[SYMBOL, blindFrame(T0 + M15)]]), 'live',
      );
      expect(summary.signals).toBe(0);
      const last = (await evaluations()).slice(-2);
      expect(last.every((e) => e.refusal === 'blind_while_armed')).toBe(true);
      // It stays ARMED: we are still holding the setup, we just cannot see.
      expect((await states()).every((s) => s.state === 'ARMED')).toBe(true);
    });
  });

  describe('the twin arms', () => {
    it('lets the gate block ONE arm while the other arms — the experiment', async () => {
      await setConfig(1, 'live', { observable: 'px.close', op: '>=', value: 200 });
      await run(T0, 105);
      expect(await states()).toEqual([
        { arm: 'gated', state: 'IDLE' }, { arm: 'unconditional', state: 'ARMED' },
      ]);
      const rows = await db.query<{ arm: string; gate_status: string | null }>(
        `select arm, gate_status from playbook_evaluations order by arm`);
      expect(rows).toEqual([
        { arm: 'gated', gate_status: 'blocked' },
        { arm: 'unconditional', gate_status: null },
      ]);
    });

    it('keeps a BLOCKED close in the comparison — that is the gate working', async () => {
      await setConfig(1, 'live', { observable: 'px.close', op: '>=', value: 200 });
      await run(T0, 105);
      const [row] = await db.query<{ exclude_from_comparison: boolean }>(
        `select exclude_from_comparison from playbook_evaluations where arm = 'gated'`);
      expect(row?.exclude_from_comparison).toBe(false);
    });

    it('EXCLUDES the close when the gate cannot be answered', async () => {
      // No regime reader is wired, so a regime-axis gate is honestly unavailable. Counting it
      // as "the gated arm did not arm" would read our own outage as the gate costing
      // performance.
      await setConfig(1, 'live', { observable: 'regime.trend', op: 'in', value: ['UP'] });
      const summary = await run(T0, 105);
      expect(summary.excluded).toBe(1);
      const [row] = await db.query<{ gate_status: string; gate_refusal: string; exclude_from_comparison: boolean }>(
        `select gate_status, gate_refusal, exclude_from_comparison
           from playbook_evaluations where arm = 'gated'`);
      expect(row).toEqual({
        gate_status: 'unavailable', gate_refusal: 'gate_axis_unavailable',
        exclude_from_comparison: true,
      });
      // The unconditional arm is untouched by any of it.
      expect((await states()).find((s) => s.arm === 'unconditional')?.state).toBe('ARMED');
    });

    it('records the unconditional arm as SHADOW even when the playbook is live', async () => {
      await run(T0, 105);
      await run(T0 + M15, 115);
      const rows = await db.query<{ arm: string; status_at_signal: string }>(
        `select arm, status_at_signal from signals order by arm`);
      expect(rows).toEqual([
        { arm: 'gated', status_at_signal: 'live' },
        { arm: 'unconditional', status_at_signal: 'shadow' },
      ]);
    });
  });

  describe('idempotent re-run', () => {
    it('inserts NOTHING NEW when run twice over the same frames', async () => {
      // Harder than it looks: the machine is stateful, so a naive second run would read the
      // state the first left behind and advance it again.
      await run(T0, 105);
      await run(T0 + M15, 115);
      const before = await db.query<{ n: string }>(
        `select (select count(*) from signals)::text || '/' ||
                (select count(*) from playbook_evaluations)::text as n`);

      const second = await run(T0, 105);
      const third = await run(T0 + M15, 115);
      const after = await db.query<{ n: string }>(
        `select (select count(*) from signals)::text || '/' ||
                (select count(*) from playbook_evaluations)::text as n`);

      expect(second.skipped).toBe(2);
      expect(third.skipped).toBe(2);
      expect(after[0]?.n).toBe(before[0]?.n);
    });

    it('leaves the STATE untouched on a re-run, not just the row counts', async () => {
      await run(T0, 105);
      await run(T0 + M15, 115);
      expect((await states()).every((s) => s.state === 'TRIGGERED')).toBe(true);
      await run(T0 + M15, 115);
      expect((await states()).every((s) => s.state === 'TRIGGERED')).toBe(true);
    });
  });

  describe('versioned config', () => {
    it('picks up a new version WITHOUT a restart', async () => {
      await setConfig(2, 'shadow');
      await run(T0, 105);
      const [row] = await db.query<{ version: number }>(
        `select version from playbook_evaluations where arm = 'gated'`);
      expect(row?.version).toBe(2);
    });

    it('does not run at all when the newest version is off', async () => {
      // `off` means off — not a revert to v1. An admin killing a playbook must not watch it
      // keep trading on older thresholds.
      await setConfig(2, 'off');
      const summary = await run(T0, 105);
      expect(summary.evaluated).toBe(0);
      expect(await evaluations()).toEqual([]);
    });

    it('keeps the version a setup ARMED under when a new one lands mid-setup', async () => {
      await run(T0, 105);              // armed under v1
      await setConfig(2, 'live');      // a new version appears
      await run(T0 + M15, 115);        // triggers
      const rows = await db.query<{ version: number }>(`select version from signals`);
      expect(rows.every((r) => r.version === 1)).toBe(true);
    });
  });

  describe('late detection', () => {
    it('REFUSES a trigger noticed more than a bar after it fired, and writes no signal', async () => {
      await setConfig(1, 'live', null, { late_detection_bound_sec: 300 });
      await run(T0, 105);
      const summary = await run(T0 + M15, 115, T0 + M15 + 3600_000); // noticed an hour later
      expect(summary.lateDetections).toBe(2);
      expect(summary.signals).toBe(0);
      const last = (await evaluations()).slice(-2);
      expect(last.every((e) => e.refusal === 'late_detection')).toBe(true);
    });

    it('writes the signal when the skew is inside the bound', async () => {
      await setConfig(1, 'live', null, { late_detection_bound_sec: 300 });
      await run(T0, 105);
      const summary = await run(T0 + M15, 115, T0 + M15 + 60_000);
      expect(summary.signals).toBe(2);
      const [row] = await db.query<{ detection_skew_sec: number }>(
        `select detection_skew_sec from signals limit 1`);
      expect(row?.detection_skew_sec).toBe(60);
    });
  });

  describe('source_mode', () => {
    it('a BACKTEST run does not touch live state or live signals', async () => {
      await run(T0, 105);
      await run(T0 + M15, 115);
      await runner.runClose('15m', T0, T0 + 15_000, [SYMBOL],
        new Map([[SYMBOL, frameAt(T0, 105)]]), 'backtest');

      const live = await db.query<{ state: string }>(
        `select state from playbook_state where source_mode = 'live' order by arm`);
      expect(live.every((s) => s.state === 'TRIGGERED')).toBe(true);
      const back = await db.query<{ state: string }>(
        `select state from playbook_state where source_mode = 'backtest' order by arm`);
      expect(back.every((s) => s.state === 'ARMED')).toBe(true);
    });
  });

  /**
   * The frame revision is pinned per close, across arms.
   *
   * The hole this closes, found in review: properties 2 and 3 open it between them. An arm can
   * fail and be retried alone (property 2), the retry is skipped for the arm that already
   * committed (property 3's ledger), and derive's heal pass produces a better-informed revision
   * in between. The twin-arm comparison then compares revision 1 against revision 2 — lookahead
   * inside LIVE mode, through a different door from the one `computed_mode` closes, and
   * invisible afterwards unless the revision each arm read is written down.
   */
  describe('frame revision pinning', () => {
    const storeFrame = async (closeMs: number, revision: number, close: number, frameVersion = 1) =>
      db.query(
        `insert into feature_frames (symbol, tf, close_time, frame_version, keys, basis, complete,
                                     revision, computed_mode, computed_at, spec_fingerprint)
         values ($1,'15m',$2,$7,$3::jsonb,'{}'::jsonb,false,$4,'live',$5,$6)
         on conflict do nothing`,
        [SYMBOL, new Date(closeMs), JSON.stringify({ 'px.close': { ok: true, value: close } }),
          revision, new Date(closeMs), featureSpecFingerprint(), frameVersion],
      );

    const frameRev = (closeMs: number, revision: number, close: number): WebFeatureFrame =>
      ({ ...frameAt(closeMs, close), revision });

    it('records the revision each arm read', async () => {
      await run(T0, 105);
      const rows = await db.query<{ arm: string; frame_revision: number }>(
        `select arm, frame_revision from playbook_evaluations order by arm`);
      expect(rows).toEqual([
        { arm: 'gated', frame_revision: 1 },
        { arm: 'unconditional', frame_revision: 1 },
      ]);
    });

    it('a sibling arm retried after a HEAL reads the PINNED revision, not the newest', async () => {
      // Step 1-2: the unconditional arm commits on revision 1; the gated arm "failed", which is
      // reproduced by removing its audit row and state so only it is outstanding.
      await storeFrame(T0, 1, 105);
      await run(T0, 105);
      await db.query(`delete from playbook_evaluations where arm = 'gated'`);
      await db.query(`delete from playbook_state where arm = 'gated'`);

      // Step 3: the heal pass produces revision 2, and it says something different — a price
      // that would NOT have armed. If the gated arm reads it, the two arms disagree for a
      // reason that has nothing to do with the gate.
      await storeFrame(T0, 2, 50);

      // Step 4: the retry is handed the newest frame, as a live caller would be.
      await runner.runClose('15m', T0, T0 + 15_000, [SYMBOL],
        new Map([[SYMBOL, frameRev(T0, 2, 50)]]), 'live');

      const rows = await db.query<{ arm: string; frame_revision: number; outcome: string }>(
        `select arm, frame_revision, outcome from playbook_evaluations order by arm`);
      expect(rows).toEqual([
        // read the pinned revision 1 and therefore armed, exactly like its sibling
        { arm: 'gated', frame_revision: 1, outcome: 'armed' },
        { arm: 'unconditional', frame_revision: 1, outcome: 'armed' },
      ]);
    });

    it('does NOT satisfy a v1 pin with the v2 frame of the same revision number', async () => {
      // IB-053. The pin is (revision, frame_version) and this is the case that forced it: both
      // versions have a revision 1 for this close, so a pin carrying only "revision 1" points at
      // two frames while looking exact.
      //
      // The two frames deliberately DISAGREE — 105 arms, 50 does not — so if the wrong one were
      // served the outcome column would say so. A fixture whose two sides agree cannot tell you
      // which was read, which is the mistake this suite's own heal test avoided.
      await storeFrame(T0, 1, 105, 1);
      await run(T0, 105);
      await db.query(`delete from playbook_evaluations where arm = 'gated'`);
      await db.query(`delete from playbook_state where arm = 'gated'`);

      // A v2 frame for the same close, same revision number, different answer.
      await storeFrame(T0, 1, 50, 2);
      await runner.runClose('15m', T0, T0 + 15_000, [SYMBOL],
        new Map([[SYMBOL, { ...frameRev(T0, 1, 50), frameVersion: 2 }]]), 'live');

      const rows = await db.query<{ arm: string; frame_revision: number; frame_version: number; outcome: string }>(
        `select arm, frame_revision, frame_version, outcome from playbook_evaluations order by arm`);
      expect(rows).toEqual([
        // the v1 pin resolved to the v1 frame, so the gated arm armed like its sibling
        { arm: 'gated', frame_revision: 1, frame_version: 1, outcome: 'armed' },
        { arm: 'unconditional', frame_revision: 1, frame_version: 1, outcome: 'armed' },
      ]);
    });

    it('REFUSES rather than substituting the newest when the pinned revision cannot be read', async () => {
      // Frames are append-only, so this is a real finding about the frames table rather than an
      // expected miss — and silently using the newer revision is the defect itself.
      await run(T0, 105);                                    // pins revision 1
      await db.query(`delete from playbook_evaluations where arm = 'gated'`);
      await db.query(`delete from playbook_state where arm = 'gated'`);
      // No feature_frames row exists for revision 1 in this test, so the pin is unsatisfiable.
      await runner.runClose('15m', T0, T0 + 15_000, [SYMBOL],
        new Map([[SYMBOL, frameRev(T0, 2, 105)]]), 'live');

      const [row] = await db.query<{ outcome: string; refusal: string }>(
        `select outcome, refusal from playbook_evaluations where arm = 'gated'`);
      expect(row).toEqual({ outcome: 'refused', refusal: 'frame_revision_unavailable' });
      // And it did NOT arm on the newer frame.
      expect((await states()).find((s) => s.arm === 'gated')).toBeUndefined();
    });

    it('does not consult a pin when this arm is the FIRST to touch the close', async () => {
      // The common path must not pay for the rare one: with no sibling row, the handed frame
      // sets the pin and is used as-is whatever its revision number happens to be.
      await runner.runClose('15m', T0, T0 + 15_000, [SYMBOL],
        new Map([[SYMBOL, frameRev(T0, 7, 105)]]), 'live');
      const rows = await db.query<{ frame_revision: number }>(
        `select frame_revision from playbook_evaluations`);
      expect(rows.every((r) => r.frame_revision === 7)).toBe(true);
    });

    it('pins per close, so a later close is free to use a later revision', async () => {
      await run(T0, 105);
      await runner.runClose('15m', T0 + M15, T0 + M15 + 15_000, [SYMBOL],
        new Map([[SYMBOL, frameRev(T0 + M15, 3, 115)]]), 'live');
      const rows = await db.query<{ close_time: Date; frame_revision: number }>(
        `select distinct close_time, frame_revision from playbook_evaluations order by close_time`);
      expect(rows.map((r) => r.frame_revision)).toEqual([1, 3]);
    });
  });
});
