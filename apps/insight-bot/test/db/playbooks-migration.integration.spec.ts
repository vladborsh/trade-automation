import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-017 migration 015 against a real Postgres.
 *
 * The properties asserted here are the ones a fake database cannot see, and every one of them is
 * a place where two different facts would otherwise share a row.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('playbooks-migration.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const CLOSE = Date.UTC(2026, 9, 12, 12, 0, 0);

maybeDescribe('IB-017 migration 015', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_pb', DATABASE_URL as string);
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
      .ensureRange(new Date(CLOSE - 40 * 86_400_000), new Date(CLOSE + 40 * 86_400_000));
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  const signal = (over: Record<string, unknown> = {}) => ({
    id: randomUUID(), playbook: 'P3', version: 1, arm: 'gated', source_mode: 'live',
    symbol: 'BTCUSDT', direction: 'long', trigger_ts: new Date(CLOSE),
    detected_at: new Date(CLOSE + 15_000), detection_skew_sec: 15, tf: '15m',
    setup: '{}', feature_snapshot: '{}', status_at_signal: 'shadow', ...over,
  });

  const insertSignal = (over: Record<string, unknown> = {}) => {
    const s = signal(over);
    return db.query(
      `insert into signals (id, playbook, version, arm, source_mode, symbol, direction,
                            trigger_ts, detected_at, detection_skew_sec, tf, setup,
                            feature_snapshot, status_at_signal)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14)`,
      [s.id, s.playbook, s.version, s.arm, s.source_mode, s.symbol, s.direction, s.trigger_ts,
        s.detected_at, s.detection_skew_sec, s.tf, s.setup, s.feature_snapshot, s.status_at_signal],
    );
  };

  describe('D12 idempotency, with source_mode', () => {
    it('REFUSES a duplicate (playbook, symbol, trigger_ts, arm, source_mode)', async () => {
      await insertSignal({ symbol: 'ETHUSDT' });
      await expect(insertSignal({ symbol: 'ETHUSDT' })).rejects.toThrow(/duplicate key/i);
    });

    it('lets a BACKTEST row coexist with the live one for the same close', async () => {
      // Without source_mode in the key these collide, and an `on conflict do nothing` silently
      // drops whichever ran second. A backtest that discards its own rows exactly where live
      // signals exist reports better-than-real performance.
      await insertSignal({ symbol: 'SOLUSDT', source_mode: 'live' });
      await expect(insertSignal({ symbol: 'SOLUSDT', source_mode: 'backtest' })).resolves.toBeDefined();
      const [row] = await db.query<{ n: string }>(
        `select count(*) as n from signals where symbol = 'SOLUSDT'`);
      expect(Number(row?.n)).toBe(2);
    });

    it('separates the two arms at the same close, which is the twin-arm design', async () => {
      await insertSignal({ symbol: 'ADAUSDT', arm: 'gated' });
      await expect(insertSignal({ symbol: 'ADAUSDT', arm: 'unconditional' })).resolves.toBeDefined();
    });

    it('REJECTS a mode that is neither live nor backtest', async () => {
      await expect(insertSignal({ symbol: 'XRPUSDT', source_mode: 'guessed' }))
        .rejects.toThrow(/invalid input value for enum|playbook_source_mode/i);
    });
  });

  describe('the two timestamps', () => {
    it('stores when it fired apart from when we saw it, with a signed skew', async () => {
      await insertSignal({ symbol: 'DOTUSDT', detected_at: new Date(CLOSE + 2700_000), detection_skew_sec: 2700 });
      const [row] = await db.query<{ trigger_ts: Date; detected_at: Date; detection_skew_sec: number }>(
        `select trigger_ts, detected_at, detection_skew_sec from signals where symbol = 'DOTUSDT'`);
      expect(new Date(row!.trigger_ts).getTime()).toBe(CLOSE);
      expect(row!.detection_skew_sec).toBe(2700);
    });

    it('accepts a NEGATIVE skew rather than rejecting it', async () => {
      // A negative skew is a clock problem, and a column that cannot hold it cannot report it —
      // the condition would surface as a failed insert instead of as the finding it is.
      await expect(insertSignal({ symbol: 'LINKUSDT', detection_skew_sec: -60 })).resolves.toBeDefined();
    });
  });

  describe('playbook_state', () => {
    const state = (over: Record<string, unknown> = {}) => db.query(
      `insert into playbook_state (playbook, symbol, arm, source_mode, state, version)
       values ($1,$2,$3,$4,$5,$6)`,
      [over.playbook ?? 'P3', over.symbol ?? 'BTCUSDT', over.arm ?? 'gated',
        over.source_mode ?? 'live', over.state ?? 'ARMED', over.version ?? 1],
    );

    it('keys on source_mode too, so a backtest cannot clobber live state', async () => {
      await state({ symbol: 'BNBUSDT', source_mode: 'live' });
      await expect(state({ symbol: 'BNBUSDT', source_mode: 'backtest' })).resolves.toBeDefined();
      await expect(state({ symbol: 'BNBUSDT', source_mode: 'live' })).rejects.toThrow(/duplicate key/i);
    });

    it('REJECTS a state outside the four', async () => {
      await expect(state({ symbol: 'AVAXUSDT', state: 'PENDING' })).rejects.toThrow(/check constraint/i);
    });
  });

  describe('playbook_evaluations — the per-close audit row', () => {
    const evaluation = (over: Record<string, unknown> = {}) => db.query(
      `insert into playbook_evaluations
         (playbook, version, symbol, arm, source_mode, close_time, outcome, refusal,
          gate_status, gate_refusal, exclude_from_comparison, frame_revision, frame_version)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [over.playbook ?? 'P3', over.version ?? 1, over.symbol ?? 'BTCUSDT', over.arm ?? 'gated',
        over.source_mode ?? 'live', over.close_time ?? new Date(CLOSE), over.outcome ?? 'declined',
        over.refusal ?? null, over.gate_status ?? null, over.gate_refusal ?? null,
        over.exclude_from_comparison ?? false, over.frame_revision ?? 1, over.frame_version ?? 1],
    );

    it('records one row per playbook x symbol x arm x close x mode', async () => {
      await evaluation({ symbol: 'BTCUSDT' });
      await expect(evaluation({ symbol: 'BTCUSDT' })).rejects.toThrow(/duplicate key/i);
      await expect(evaluation({ symbol: 'BTCUSDT', arm: 'unconditional' })).resolves.toBeDefined();
    });

    it('carries the VERSION, because "did not arm" is meaningless without the rules', async () => {
      await evaluation({ symbol: 'ETHUSDT', version: 2 });
      const [row] = await db.query<{ version: number }>(
        `select version from playbook_evaluations where symbol = 'ETHUSDT'`);
      expect(row?.version).toBe(2);
    });

    it('distinguishes DECLINED from REFUSED', async () => {
      // "Evaluated and did not arm" is a statement about the market; "could not evaluate" is a
      // gap in our data. An absent row would be ambiguous between them, which is why the row
      // exists at all.
      await evaluation({ symbol: 'SOLUSDT', outcome: 'declined', refusal: null });
      await evaluation({ symbol: 'SOLUSDT', arm: 'unconditional', outcome: 'refused', refusal: 'insufficient_features' });
      const rows = await db.query<{ outcome: string; refusal: string | null }>(
        `select outcome, refusal from playbook_evaluations where symbol = 'SOLUSDT' order by arm`);
      expect(rows).toEqual([
        { outcome: 'declined', refusal: null },
        { outcome: 'refused', refusal: 'insufficient_features' },
      ]);
    });

    it('records the gate as three states, not a boolean', async () => {
      await evaluation({ symbol: 'ADAUSDT', gate_status: 'blocked' });
      await evaluation({
        symbol: 'ADAUSDT', arm: 'unconditional', gate_status: 'unavailable',
        gate_refusal: 'gate_axis_unavailable', exclude_from_comparison: true,
      });
      const rows = await db.query<{ gate_status: string; exclude_from_comparison: boolean }>(
        `select gate_status, exclude_from_comparison from playbook_evaluations
          where symbol = 'ADAUSDT' order by arm`);
      expect(rows[0]).toEqual({ gate_status: 'blocked', exclude_from_comparison: false });
      expect(rows[1]).toEqual({ gate_status: 'unavailable', exclude_from_comparison: true });
    });

    it('REJECTS an unknown refusal or gate reason rather than storing free text', async () => {
      await expect(evaluation({ symbol: 'XRPUSDT', outcome: 'refused', refusal: 'because' }))
        .rejects.toThrow(/check constraint/i);
      await expect(evaluation({ symbol: 'XRPUSDT', gate_status: 'maybe' }))
        .rejects.toThrow(/check constraint/i);
    });

    it('REFUSES a close with no partition, rather than parking it somewhere wrong', async () => {
      await expect(evaluation({ symbol: 'DOTUSDT', close_time: new Date(Date.UTC(2031, 0, 1)) }))
        .rejects.toThrow(/no partition/i);
    });

    it('REQUIRES the frame revision — the two arms of a close must be comparable', async () => {
      // Not nullable: without it nobody can tell afterwards whether the arms of one close read
      // the same information, and the case where they did not is invisible in every other
      // column. A default would let a writer omit it and reintroduce exactly that blindness.
      // `frame_version` is supplied so the rejection is unambiguously ABOUT frame_revision:
      // IB-053 made both not-null, and omitting both would let this pass on the wrong column.
      await expect(db.query(
        `insert into playbook_evaluations
           (playbook, version, symbol, arm, source_mode, close_time, outcome, frame_version)
         values ('P3',1,'LTCUSDT','gated','live',$1,'declined',1)`, [new Date(CLOSE)],
      )).rejects.toThrow(/frame_revision/i);
    });

    it('REQUIRES the frame VERSION too — a revision alone stopped identifying one frame', async () => {
      // IB-053. The mirror of the assertion above, and it exists because the pin is now two
      // halves: v1 revision 1 and v2 revision 1 are different frames, so an audit row carrying
      // only the revision points at both while looking exact.
      await expect(db.query(
        `insert into playbook_evaluations
           (playbook, version, symbol, arm, source_mode, close_time, outcome, frame_revision)
         values ('P3',1,'XRPUSDT','gated','live',$1,'declined',1)`, [new Date(CLOSE)],
      )).rejects.toThrow(/frame_version/i);
    });

    it('accepts frame_revision_unavailable as a refusal', async () => {
      // The pin could not be satisfied. Refused loudly rather than silently substituting the
      // newest revision, which is the defect itself.
      await expect(evaluation({
        symbol: 'ATOMUSDT', outcome: 'refused', refusal: 'frame_revision_unavailable',
      })).resolves.toBeDefined();
    });

    it('is partitioned on close_time', async () => {
      const [row] = await db.query<{ partkey: string }>(
        `select pg_get_partkeydef('playbook_evaluations'::regclass) as partkey`);
      expect(row?.partkey).toContain('close_time');
    });
  });
});
