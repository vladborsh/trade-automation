import { BatchWriter, lastPerConflictKey } from '../src/collectors/writers/batch-writer';
import * as t from '../src/collectors/writers/tables';
import { buildInsert, buildUpsert, chunk, MAX_ROWS_PER_STATEMENT, updatedColumns } from '../src/collectors/writers/upsert';
import { Db, DbHandle } from '../src/db/db.port';

describe('buildUpsert', () => {
  it('numbers placeholders across the whole batch and updates every non-key column', () => {
    const spec = { table: 'open_interest_5m', columns: ['venue', 'symbol', 'ts', 'oi_base'], conflict: ['venue', 'symbol', 'ts'] };
    expect(buildUpsert(spec, 2)).toBe(
      'insert into open_interest_5m (venue, symbol, ts, oi_base) values ($1, $2, $3, $4), ($5, $6, $7, $8) ' +
        'on conflict (venue, symbol, ts) do update set oi_base = excluded.oi_base',
    );
  });

  it('writes DO NOTHING when a table declares no updatable column', () => {
    expect(buildUpsert(t.LIQUIDATIONS, 1)).toContain('do nothing');
    expect(buildUpsert(t.LIQUIDATIONS, 1)).toContain('on conflict (venue, symbol, ts, side, price, qty)');
  });

  it('enforces the 500-row cap and a sane row count', () => {
    expect(() => buildUpsert(t.OPEN_INTEREST_5M, MAX_ROWS_PER_STATEMENT + 1)).toThrow(/exceeds the 500-row cap/);
    expect(() => buildUpsert(t.OPEN_INTEREST_5M, 0)).toThrow(/positive integer/);
    expect(buildUpsert(t.OPEN_INTEREST_5M, MAX_ROWS_PER_STATEMENT)).toContain(`$${MAX_ROWS_PER_STATEMENT * t.OPEN_INTEREST_5M.columns.length}`);
  });

  it('refuses a conflict column that is not being inserted, and a non-identifier name', () => {
    expect(() => buildUpsert({ table: 'open_interest_5m', columns: ['venue'], conflict: ['symbol'] }, 1)).toThrow(
      /Conflict column 'symbol' is not among/,
    );
    expect(() => buildUpsert({ table: 'open_interest_5m; drop table symbols', columns: ['venue'], conflict: ['venue'] }, 1)).toThrow(
      /Invalid table/,
    );
  });

  it('sends an append-only table to buildInsert instead', () => {
    expect(() => buildUpsert(t.COLLECTOR_GAPS, 1)).toThrow(/declares no natural key/);
    expect(buildInsert(t.COLLECTOR_GAPS, 1)).toBe(
      'insert into collector_gaps (stream, venue, market, symbol, gap_from, gap_to, expected, repaired, error, detected_at) ' +
        'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    );
  });
});

describe('the §3.3 table specs', () => {
  const specs: Array<[string, { table: string; columns: readonly string[]; conflict: readonly string[] }, (row: never) => unknown[], unknown]> = [
    ['open_interest_5m', t.OPEN_INTEREST_5M, t.openInterestTuple as never, { venue: 'binance', symbol: 'BTCUSDT', ts: new Date(0), oiBase: 100, source: 'rest' }],
    ['long_short_5m', t.LONG_SHORT_5M, t.longShortTuple as never, { venue: 'binance', symbol: 'BTCUSDT', ts: new Date(0), kind: 'taker', source: 'rest' }],
    ['liquidations', t.LIQUIDATIONS, t.liquidationTuple as never, { venue: 'binance', symbol: 'BTCUSDT', ts: new Date(0), side: 'long', price: 1, qty: 2, notional: 2, source: 'ws' }],
    ['calendar_events', t.CALENDAR_EVENTS, t.calendarEventTuple as never, { id: 'e1', revision: 1, source: 'ff', eventTime: new Date(0), status: 'scheduled', fetchedAt: new Date(0) }],
    ['collector_gaps', t.COLLECTOR_GAPS, t.collectorGapTuple as never, { stream: 's', venue: 'binance', gapFrom: new Date(0), gapTo: new Date(0), expected: 3, detectedAt: new Date(0) }],
  ];

  it.each(specs)('%s: the mapper supplies exactly one value per insert column', (_name, spec, toTuple, row) => {
    expect((toTuple as (r: unknown) => unknown[])(row)).toHaveLength(spec.columns.length);
  });

  it.each(specs)('%s: every conflict column is an inserted column', (_name, spec) => {
    for (const column of spec.conflict) expect(spec.columns).toContain(column);
  });

  it('never updates a key column on conflict', () => {
    for (const [, spec] of specs) {
      for (const column of updatedColumns(spec as never)) expect(spec.conflict).not.toContain(column);
    }
  });

  it('maps an omitted optional field to null, not to 0 or undefined', () => {
    // §2.3's rule for a missing spot market applies to every nullable column: a value the venue
    // did not send is null, never a silent zero.
    expect(t.openInterestTuple({ venue: 'binance', symbol: 'BTCUSDT', ts: new Date(0), oiBase: 100, source: 'rest' })[4]).toBeNull();
    const ls = t.longShortTuple({ venue: 'binance', symbol: 'BTCUSDT', ts: new Date(0), kind: 'taker', source: 'rest' });
    expect(ls.slice(4).filter((v) => v === undefined || v === 0)).toEqual([]);
  });

  it('defaults a gap row\'s repaired count to 0, since none of it is repaired yet', () => {
    const tuple = t.collectorGapTuple({ stream: 's', venue: 'binance', gapFrom: new Date(0), gapTo: new Date(0), expected: 3, detectedAt: new Date(0) });
    expect(tuple[7]).toBe(0);
  });
});

describe('chunk', () => {
  it('splits at the cap, with a short last batch', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
    expect(chunk(Array.from({ length: 1001 }, (_, i) => i))).toHaveLength(3);
    expect(() => chunk([1], 0)).toThrow(/positive integer/);
  });
});

/** Records every statement, so the batching is observable without a database. */
class FakeDb implements Db {
  readonly calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    this.calls.push({ sql, params });
    return [] as T[];
  }
  async transaction<T>(fn: (tx: DbHandle) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

describe('BatchWriter', () => {
  const row = (slot: number): t.OpenInterestRow => ({
    venue: 'binance', symbol: 'BTCUSDT', ts: new Date(Date.UTC(2026, 8, 28) + slot * 300_000), oiBase: 100 + slot, source: 'rest',
  });

  it('writes nothing, and runs no statement, for an empty batch', async () => {
    const db = new FakeDb();
    expect(await new BatchWriter(db, t.OPEN_INTEREST_5M, t.openInterestTuple).write([])).toBe(0);
    expect(db.calls).toHaveLength(0);
  });

  it('sends one statement per 500 rows and flattens the tuples in column order', async () => {
    const db = new FakeDb();
    const rows = Array.from({ length: 501 }, (_, i) => row(i));
    expect(await new BatchWriter(db, t.OPEN_INTEREST_5M, t.openInterestTuple).write(rows)).toBe(501);

    expect(db.calls).toHaveLength(2);
    expect(db.calls[0].params).toHaveLength(500 * t.OPEN_INTEREST_5M.columns.length);
    expect(db.calls[1].params).toHaveLength(1 * t.OPEN_INTEREST_5M.columns.length);
    expect(db.calls[0].params.slice(0, 4)).toEqual(['binance', 'BTCUSDT', rows[0].ts, 100]);
    for (const call of db.calls) expect(call.sql).toContain('on conflict (venue, symbol, ts) do update');
  });

  it('is idempotent by construction: the same batch twice issues the same upsert', async () => {
    const db = new FakeDb();
    const writer = new BatchWriter(db, t.OPEN_INTEREST_5M, t.openInterestTuple);
    await writer.write([row(0)]);
    await writer.write([row(0)]);
    expect(db.calls[0]).toEqual(db.calls[1]);
  });

  it('counts the rows it wrote on ib_rows_written_total{table}', async () => {
    const inc = jest.fn();
    const metrics = { rowsWritten: { inc } } as never;
    await new BatchWriter(new FakeDb(), t.OPEN_INTEREST_5M, t.openInterestTuple, metrics).write([row(0), row(1)]);
    expect(inc).toHaveBeenCalledWith({ table: 'open_interest_5m' }, 2);
  });

  it('runs on a caller-supplied handle, so a collector can write several tables in one transaction', async () => {
    const db = new FakeDb();
    await db.transaction(async (tx) => {
      await new BatchWriter(db, t.OPEN_INTEREST_5M, t.openInterestTuple).writeOn(tx, [row(0)]);
      await new BatchWriter(db, t.LIQUIDATIONS, t.liquidationTuple).writeOn(tx, [
        { venue: 'binance', symbol: 'BTCUSDT', ts: new Date(0), side: 'long', price: 1, qty: 2, notional: 2, source: 'ws' },
      ]);
    });
    expect(db.calls.map((c) => c.sql.split(' ')[2])).toEqual(['open_interest_5m', 'liquidations']);
  });
});

describe('IB-BUG-015 — a batch naming one natural key twice', () => {
  // since WD-010 the repeat-key batch is the OI poll overlapping the boot backfill: same slot twice
  const oi = (oiBase: number, symbol = 'BTCUSDT'): t.OpenInterestRow => ({
    venue: 'binance', symbol, ts: new Date(Date.UTC(2026, 10, 3, 8)), oiBase, source: 'rest',
  });

  it('sends one row per key, the last one winning, and counts what it sent', async () => {
    const db = new FakeDb();
    const inc = jest.fn();
    const writer = new BatchWriter(db, t.OPEN_INTEREST_5M, t.openInterestTuple, { rowsWritten: { inc } } as never);
    // a NEW Date per row, as the mapper makes them: equal instants, different objects
    expect(await writer.write([oi(1), oi(2, 'ETHUSDT'), oi(3)])).toBe(2);

    expect(db.calls).toHaveLength(1);
    const rows = chunkParams(db.calls[0].params, t.OPEN_INTEREST_5M.columns.length);
    expect(rows.map((r) => [r[1], r[3]])).toEqual([['ETHUSDT', 2], ['BTCUSDT', 3]]);
    expect(inc).toHaveBeenCalledWith({ table: 'open_interest_5m' }, 2);
  });

  it('leaves a DO NOTHING table and an append-only one exactly as given', () => {
    const liq = t.liquidationTuple({ venue: 'okx', symbol: 'BTC-USDT-SWAP', ts: new Date(0), side: 'long', price: 1, qty: 2, notional: 2, source: 'ws' });
    expect(lastPerConflictKey(t.LIQUIDATIONS, [liq, [...liq]])).toHaveLength(2);
    const gap = t.collectorGapTuple({ stream: 's', venue: 'okx', gapFrom: new Date(0), gapTo: new Date(0), expected: 1, detectedAt: new Date(0) });
    expect(lastPerConflictKey(t.COLLECTOR_GAPS, [gap, [...gap]])).toHaveLength(2);
  });

  it('keeps rows whose keys differ only in a way Postgres also tells apart', () => {
    const a = t.openInterestTuple({ venue: 'binance', symbol: 'X', ts: new Date(300_000), oiBase: 1, source: 'rest' });
    const b = t.openInterestTuple({ venue: 'binance', symbol: 'X', ts: new Date(300_001), oiBase: 1, source: 'rest' });
    const c = t.openInterestTuple({ venue: 'bybit', symbol: 'X', ts: new Date(300_000), oiBase: 1, source: 'rest' });
    expect(lastPerConflictKey(t.OPEN_INTEREST_5M, [a, b, c])).toHaveLength(3);
  });

  it('a refused statement names its table and the row count', async () => {
    const db: Db = {
      query: async () => { throw new Error('ON CONFLICT DO UPDATE command cannot affect row a second time'); },
      transaction: async (fn) => fn(db),
    };
    await expect(new BatchWriter(db, t.OPEN_INTEREST_5M, t.openInterestTuple).write([oi(1)])).rejects.toThrow(
      'open_interest_5m: write of 1 of 1 row(s) failed: ON CONFLICT DO UPDATE command cannot affect row a second time',
    );
  });
});

function chunkParams(params: readonly unknown[], width: number): unknown[][] {
  const out: unknown[][] = [];
  for (let i = 0; i < params.length; i += width) out.push(params.slice(i, i + width) as unknown[]);
  return out;
}
