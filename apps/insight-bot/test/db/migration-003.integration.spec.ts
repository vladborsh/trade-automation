import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { buildEventsInWindow, buildHighImpactUsdWindow, EventInWindow } from '../../src/collectors/calendar/events-in-window';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * Migration 003 (§16.7) against a real Postgres: the three columns and the index apply and undo,
 * the writer round-trips them, and — the point of the whole migration — §9.3's query sees an
 * event's latest revision and only while that revision is `scheduled`.
 *
 * Runs in a throwaway database next to the slot's own. Skipped without DATABASE_URL:
 *   DATABASE_URL=postgresql://backtest:backtest@localhost:5432/insight_dev1 npm test
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-003.integration.spec.ts: DATABASE_URL not set — skipping the calendar projection tests.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const NFP = new Date('2026-09-04T12:30:00Z');

maybeDescribe('migration 003: the calendar projection columns', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let writer: BatchWriter<t.CalendarEventRow>;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_cal', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    db = new PgDatabase(url.toString());
    await runMigrations({ connectionString: url.toString() });
    writer = new BatchWriter(db, t.CALENDAR_EVENTS, t.calendarEventTuple);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  beforeEach(async () => {
    await db.query('delete from calendar_events');
  });

  function row(overrides: Partial<t.CalendarEventRow> = {}): t.CalendarEventRow {
    return {
      id: 'ff:832:2026-09-04',
      revision: 1,
      source: 'forexfactory',
      seriesId: '832',
      eventTime: NFP,
      currency: 'USD',
      title: 'Non-Farm Employment Change',
      impact: 'high',
      status: 'scheduled',
      forecast: '165K',
      previous: '142K',
      actual: null,
      actualSource: null,
      fetchedAt: new Date(),
      ...overrides,
    };
  }

  it('adds the three columns, with status defaulting to scheduled', async () => {
    const columns = await db.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
      `select column_name, is_nullable, column_default from information_schema.columns
        where table_name = 'calendar_events' and column_name in ('series_id', 'status', 'actual_source')
        order by column_name`,
    );
    expect(columns.map((c) => c.column_name)).toEqual(['actual_source', 'series_id', 'status']);
    const status = columns.find((c) => c.column_name === 'status');
    expect(status?.is_nullable).toBe('NO');
    expect(status?.column_default).toContain('scheduled');
  });

  it('creates the (impact, currency, event_time) index §9.3 reads through', async () => {
    const [index] = await db.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where indexname = 'calendar_events_impact_currency_time_idx'",
    );
    expect(index.indexdef).toMatch(/\(impact, currency, event_time\)/);
  });

  it('round-trips every projection column through the writer', async () => {
    await writer.write([row({ actual: '151K', actualSource: 'next-previous' })]);
    const [stored] = await db.query<EventInWindow>('select * from calendar_events');
    expect(stored).toMatchObject({
      series_id: '832',
      status: 'scheduled',
      actual: '151K',
      actual_source: 'next-previous',
      currency: 'USD',
      impact: 'high',
    });
  });

  it('keeps every revision — the PK is (id, revision), so a second revision is a second row', async () => {
    await writer.write([row(), row({ revision: 2, forecast: '170K' })]);
    const stored = await db.query<{ revision: number }>('select revision from calendar_events order by revision');
    expect(stored.map((r) => r.revision)).toEqual([1, 2]);
  });

  describe('§9.3: the veto query', () => {
    const from = new Date(NFP.getTime() - 60 * 60_000);
    const to = new Date(NFP.getTime() + 60 * 60_000);

    const veto = async (): Promise<EventInWindow[]> => {
      const { sql, params } = buildHighImpactUsdWindow(from, to);
      return db.query<EventInWindow>(sql, params);
    };

    it('returns a high-impact USD event inside ±60 min', async () => {
      await writer.write([row()]);
      expect((await veto()).map((r) => r.id)).toEqual(['ff:832:2026-09-04']);
    });

    it('returns it ONCE when it has several revisions, at the newest one', async () => {
      await writer.write([row(), row({ revision: 2, forecast: '170K' }), row({ revision: 3, forecast: '175K' })]);
      const found = await veto();
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ revision: 3, forecast: '175K' });
    });

    it('drops it once its LATEST revision is cancelled — the correctness requirement', async () => {
      await writer.write([row(), row({ revision: 2, status: 'cancelled' })]);
      expect(await veto()).toEqual([]);
    });

    it('brings it back if a later revision schedules it again', async () => {
      await writer.write([row(), row({ revision: 2, status: 'cancelled' }), row({ revision: 3 })]);
      expect((await veto()).map((r) => r.revision)).toEqual([3]);
    });

    it('ignores another currency, a lower impact, and an event outside the window', async () => {
      await writer.write([
        row({ id: 'ff:1:eur', currency: 'EUR' }),
        row({ id: 'ff:2:med', impact: 'medium' }),
        row({ id: 'ff:3:late', eventTime: new Date(NFP.getTime() + 61 * 60_000) }),
      ]);
      expect(await veto()).toEqual([]);
    });

    it('orders several events by time, and the shared builder can widen to any window', async () => {
      const later = new Date(NFP.getTime() + 30 * 60_000);
      await writer.write([row({ id: 'b', eventTime: later }), row({ id: 'a' })]);
      expect((await veto()).map((r) => r.id)).toEqual(['a', 'b']);

      // the smoke query from IB-010's done-line: the same function, a 24 h window
      const { sql, params } = buildEventsInWindow({
        from: NFP,
        to: new Date(NFP.getTime() + 24 * 60 * 60_000),
        impact: 'high',
        currency: 'USD',
      });
      expect((await db.query<EventInWindow>(sql, params)).map((r) => r.id)).toEqual(['a', 'b']);
    });
  });

  it('undoes cleanly and re-applies', async () => {
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    await runMigrations({ connectionString: url.toString(), target: '002' });
    const after = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'calendar_events' and column_name in ('series_id', 'status', 'actual_source')`,
    );
    expect(after).toEqual([]);

    await runMigrations({ connectionString: url.toString() });
    const back = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'calendar_events' and column_name in ('series_id', 'status', 'actual_source')`,
    );
    expect(back).toHaveLength(3);
  }, DB_HOOK_TIMEOUT_MS);
});
