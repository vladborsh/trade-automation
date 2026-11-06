import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { AlertMarksController } from '../../src/web/series/alert-marks.controller';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';
import { enterDetails, flipDetails, liqDetails } from '../web/alert-marks.fixtures';

/**
 * IB-129 — the alert-marks read against a real `market_alerts`: the SQL is the rule on which journal rows are
 * marks (live, not late, liq `alert`, funding `enter`/`flip`, the coin, `[from, to)`), and a fake cannot check it.
 * Every excluded row below sits INSIDE the window on the same coin, so it is excluded by its own reason only.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('alert-marks.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const T = Date.UTC(2026, 10, 5, 12, 0, 0);
const MIN = 60_000;

maybeDescribe('IB-129 alert marks against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let n = 0;

  const insert = (o: { type?: string; event: string; symbol?: string; atMs: number; details: unknown; source?: string; late?: boolean; mutedBy?: string }) =>
    db.query(
      `insert into market_alerts (type, event, symbol, at, tf, details, params, source, build, confirmed_at, dedupe_key, late, muted_by)
       values ($1, $2, $3, $4, '5m', $5, '{}', $6, 'dev', $4, $7, $8, $9)`,
      [o.type ?? 'liq', o.event, o.symbol ?? 'BTCUSDT', new Date(o.atMs), JSON.stringify(o.details), o.source ?? 'live', `k${++n}`, o.late ?? false, o.mutedBy ?? null],
    );

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_marks', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: u.toString() });
    db = new PgDatabase(u.toString());

    // the marks
    await insert({ event: 'alert', atMs: T, details: liqDetails });
    await insert({ type: 'funding', event: 'enter', atMs: T + 10 * MIN, details: enterDetails });
    await insert({ type: 'funding', event: 'flip', atMs: T + 20 * MIN, details: flipDetails });
    await insert({ event: 'alert', atMs: T - 60 * MIN, details: liqDetails }); // on `from` exactly: in
    // not marks, each for one reason
    await insert({ event: 'alert', atMs: T + 1 * MIN, details: liqDetails, source: 'backfill' });
    await insert({ event: 'alert', atMs: T + 2 * MIN, details: liqDetails, late: true });
    await insert({ event: 'event', atMs: T + 3 * MIN, details: {} });
    await insert({ event: 'event_continuing', atMs: T + 4 * MIN, details: {} });
    await insert({ event: 'continuing', atMs: T + 5 * MIN, details: {} });
    await insert({ type: 'level', event: 'breakout_up', atMs: T + 6 * MIN, details: {} });
    await insert({ event: 'alert', symbol: 'ETHUSDT', atMs: T + 7 * MIN, details: liqDetails });
    // IB-151: a crossing of a coin switched off, and a funding enter likewise — never written before IB-151, so never a mark
    await insert({ event: 'alert', atMs: T + 8 * MIN, details: liqDetails, mutedBy: 'coin' });
    await insert({ type: 'funding', event: 'enter', atMs: T + 9 * MIN, details: enterDetails, mutedBy: 'coin' });
    await insert({ event: 'alert', atMs: T + 60 * MIN, details: liqDetails }); // on `to` exactly: out
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('exactly the live, not-late liq crossings and funding enter/flip of the coin in [from, to), oldest first', async () => {
    const res = await new AlertMarksController(db).alertMarks('BTCUSDT', String(T - 60 * MIN), String(T + 60 * MIN));
    expect(res.marks.map((m) => [m.type, m.type === 'funding' ? m.event : 'alert', (m.at * 1000 - T) / MIN])).toEqual([
      ['liq', 'alert', -60], ['liq', 'alert', 0], ['funding', 'enter', 10], ['funding', 'flip', 20],
    ]);
    expect(res.truncated).toBe(false);
  });

  it('the other coin has its own marks only', async () => {
    const res = await new AlertMarksController(db).alertMarks('ETHUSDT', String(T - 60 * MIN), String(T + 60 * MIN));
    expect(res.marks.map((m) => (m.at * 1000 - T) / MIN)).toEqual([7]);
  });
});
