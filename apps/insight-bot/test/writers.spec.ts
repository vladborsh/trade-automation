import { BatchWriter } from '../src/collectors/writers/batch-writer';
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
    expect(() => buildUpsert(t.CANDLES_1M, MAX_ROWS_PER_STATEMENT + 1)).toThrow(/exceeds the 500-row cap/);
    expect(() => buildUpsert(t.CANDLES_1M, 0)).toThrow(/positive integer/);
    expect(buildUpsert(t.CANDLES_1M, MAX_ROWS_PER_STATEMENT)).toContain(`$${MAX_ROWS_PER_STATEMENT * t.CANDLES_1M.columns.length}`);
  });

  it('refuses a conflict column that is not being inserted, and a non-identifier name', () => {
    expect(() => buildUpsert({ table: 'candles_1m', columns: ['venue'], conflict: ['symbol'] }, 1)).toThrow(
      /Conflict column 'symbol' is not among/,
    );
    expect(() => buildUpsert({ table: 'candles_1m; drop table symbols', columns: ['venue'], conflict: ['venue'] }, 1)).toThrow(
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
    ['candles_1m', t.CANDLES_1M, t.candle1mTuple as never, { venue: 'binance', market: 'perp', symbol: 'BTCUSDT', openTime: new Date(0), open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, source: 'ws' }],
    ['candles_agg', t.CANDLES_AGG, t.candleAggTuple as never, { venue: 'binance', market: 'perp', symbol: 'BTCUSDT', tf: '15m', openTime: new Date(0), open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, bars: 15, complete: true }],
    ['mark_funding_1m', t.MARK_FUNDING_1M, t.markFundingTuple as never, { venue: 'binance', symbol: 'BTCUSDT', ts: new Date(0), source: 'ws' }],
    ['funding_settlements', t.FUNDING_SETTLEMENTS, t.fundingSettlementTuple as never, { venue: 'binance', symbol: 'BTCUSDT', fundingTime: new Date(0), rate: 0.0001, source: 'rest' }],
    ['open_interest_5m', t.OPEN_INTEREST_5M, t.openInterestTuple as never, { venue: 'binance', symbol: 'BTCUSDT', ts: new Date(0), oiBase: 100, source: 'rest' }],
    ['long_short_5m', t.LONG_SHORT_5M, t.longShortTuple as never, { venue: 'binance', symbol: 'BTCUSDT', ts: new Date(0), kind: 'taker', source: 'rest' }],
    ['liquidations', t.LIQUIDATIONS, t.liquidationTuple as never, { venue: 'binance', symbol: 'BTCUSDT', ts: new Date(0), side: 'long', price: 1, qty: 2, notional: 2, source: 'ws' }],
    ['calendar_events', t.CALENDAR_EVENTS, t.calendarEventTuple as never, { id: 'e1', revision: 1, source: 'ff', eventTime: new Date(0), fetchedAt: new Date(0) }],
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
    const tuple = t.candle1mTuple({
      venue: 'binance', market: 'spot', symbol: 'BTCUSDT', openTime: new Date(0),
      open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, source: 'ws',
    });
    expect(tuple.slice(9, 13)).toEqual([null, null, null, null]);
    expect(t.markFundingTuple({ venue: 'bybit', symbol: 'BTCUSDT', ts: new Date(0), source: 'ws' }).slice(3, 7)).toEqual([
      null, null, null, null,
    ]);
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
  const row = (minute: number): t.Candle1mRow => ({
    venue: 'binance', market: 'perp', symbol: 'BTCUSDT',
    openTime: new Date(Date.UTC(2026, 8, 28, 0, minute)),
    open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, source: 'ws',
  });

  it('writes nothing, and runs no statement, for an empty batch', async () => {
    const db = new FakeDb();
    expect(await new BatchWriter(db, t.CANDLES_1M, t.candle1mTuple).write([])).toBe(0);
    expect(db.calls).toHaveLength(0);
  });

  it('sends one statement per 500 rows and flattens the tuples in column order', async () => {
    const db = new FakeDb();
    const rows = Array.from({ length: 501 }, (_, i) => row(i));
    expect(await new BatchWriter(db, t.CANDLES_1M, t.candle1mTuple).write(rows)).toBe(501);

    expect(db.calls).toHaveLength(2);
    expect(db.calls[0].params).toHaveLength(500 * t.CANDLES_1M.columns.length);
    expect(db.calls[1].params).toHaveLength(1 * t.CANDLES_1M.columns.length);
    expect(db.calls[0].params.slice(0, 4)).toEqual(['binance', 'perp', 'BTCUSDT', rows[0].openTime]);
    for (const call of db.calls) expect(call.sql).toContain('on conflict (venue, market, symbol, open_time) do update');
  });

  it('is idempotent by construction: the same batch twice issues the same upsert', async () => {
    const db = new FakeDb();
    const writer = new BatchWriter(db, t.CANDLES_1M, t.candle1mTuple);
    await writer.write([row(0)]);
    await writer.write([row(0)]);
    expect(db.calls[0]).toEqual(db.calls[1]);
  });

  it('counts the rows it wrote on ib_rows_written_total{table}', async () => {
    const inc = jest.fn();
    const metrics = { rowsWritten: { inc } } as never;
    await new BatchWriter(new FakeDb(), t.CANDLES_1M, t.candle1mTuple, metrics).write([row(0), row(1)]);
    expect(inc).toHaveBeenCalledWith({ table: 'candles_1m' }, 2);
  });

  it('runs on a caller-supplied handle, so a collector can write several tables in one transaction', async () => {
    const db = new FakeDb();
    await db.transaction(async (tx) => {
      await new BatchWriter(db, t.CANDLES_1M, t.candle1mTuple).writeOn(tx, [row(0)]);
      await new BatchWriter(db, t.LIQUIDATIONS, t.liquidationTuple).writeOn(tx, [
        { venue: 'binance', symbol: 'BTCUSDT', ts: new Date(0), side: 'long', price: 1, qty: 2, notional: 2, source: 'ws' },
      ]);
    });
    expect(db.calls.map((c) => c.sql.split(' ')[2])).toEqual(['candles_1m', 'liquidations']);
  });
});
