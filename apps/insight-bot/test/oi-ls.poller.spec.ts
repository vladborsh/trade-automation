import { BinanceWeightTracker } from '../src/venues/binance/binance-weight.tracker';
import { FuturesDataClient } from '../src/venues/binance/futures-data.client';
import { OiLsPoller, POLL_LIMIT, STREAM_ID } from '../src/collectors/binance-perp/oi-ls.poller';
import { BatchWriter } from '../src/collectors/writers/batch-writer';
import * as t from '../src/collectors/writers/tables';
import { MetricsService } from '../src/ops/metrics.service';
import { StreamRegistry } from '../src/ops/stream-registry';
import { Db, DbHandle } from '../src/db/db.port';
import { PartitionMaintenanceService } from '../src/db/partitions.service';

const SLOT = 300_000;
const SLOT_TS = Date.UTC(2026, 8, 28, 12, 5);

/** A db that answers the poller's two queries from what the test seeds. */
class FakeDb implements Db {
  constructor(
    private readonly lastBySymbol: Record<string, Date | null> = {},
    private readonly stored: Date[] = [],
  ) {}
  async query<T>(sql: string, _params: readonly unknown[] = []): Promise<T[]> {
    if (sql.includes('max(o.ts)')) {
      return Object.entries(this.lastBySymbol).map(([symbol, last]) => ({ symbol, last })) as T[];
    }
    if (sql.includes('select ts from open_interest_5m')) return this.stored.map((ts) => ({ ts })) as T[];
    return [] as T[];
  }
  async transaction<T>(fn: (tx: DbHandle) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

/** Captures what each writer was handed, without a database. */
function fakeWriters(onGaps?: (rows: t.CollectorGapRow[]) => void) {
  const written: Record<string, unknown[]> = { oi: [], ls: [], gaps: [] };
  const writer = (key: string) =>
    ({ write: async (rows: unknown[]) => {
      written[key].push(...rows);
      if (key === 'gaps') onGaps?.(rows as t.CollectorGapRow[]); // written through, as the real writer does
      return rows.length;
    } }) as unknown as BatchWriter<never>;
  return {
    written,
    writers: { openInterest: writer('oi'), longShort: writer('ls'), collectorGaps: writer('gaps') } as never,
  };
}

function fakeConfig(symbols: string[]) {
  return {
    symbols: symbols.map((id) => ({ binance_perp: id })),
    env: { get: (key: string) => (key === 'BINANCE_FUTURES_REST_BASE_URL' ? 'https://fapi.binance.com' : undefined) },
  } as never;
}

/** A client whose five endpoints answer from canned rows, and which records what was asked. */
function fakeClient(rowsFor: (endpoint: string, symbol: string) => unknown[] | Error) {
  const asked: Array<{ endpoint: string; symbol: string; limit?: number }> = [];
  return {
    asked,
    client: {
      async fetchPage({ endpoint, symbol, limit }: { endpoint: string; symbol: string; limit?: number }) {
        asked.push({ endpoint, symbol, limit });
        const result = rowsFor(endpoint, symbol);
        if (result instanceof Error) throw result;
        return result;
      },
      async fetchBackward({ endpoint, symbol }: { endpoint: string; symbol: string }) {
        asked.push({ endpoint, symbol });
        const result = rowsFor(endpoint, symbol);
        if (result instanceof Error) throw result;
        return result;
      },
    } as unknown as FuturesDataClient,
  };
}

const oiRow = (ts: number) => ({ symbol: 'BTCUSDT', sumOpenInterest: '100', sumOpenInterestValue: '1000', timestamp: ts });
const lsRow = (ts: number) => ({ symbol: 'BTCUSDT', longAccount: '0.6', shortAccount: '0.4', longShortRatio: '1.5', timestamp: ts });
const takerRow = (ts: number) => ({ buySellRatio: '1.1', buyVol: '110', sellVol: '100', timestamp: ts });

function build(opts: {
  symbols?: string[];
  rowsFor?: (endpoint: string, symbol: string) => unknown[] | Error;
  db?: Db;
  onGaps?: (rows: t.CollectorGapRow[]) => void;
}) {
  const { written, writers } = fakeWriters(opts.onGaps);
  const streams = new StreamRegistry();
  const metrics = new MetricsService(streams);
  const weight = new BinanceWeightTracker();
  const rowsFor =
    opts.rowsFor ??
    ((endpoint: string) => (endpoint === 'takerlongshortRatio' ? [takerRow(SLOT_TS)] : endpoint === 'openInterestHist' ? [oiRow(SLOT_TS)] : [lsRow(SLOT_TS)]));
  const { client, asked } = fakeClient(rowsFor);
  const db = opts.db ?? new FakeDb();
  // A real PartitionMaintenanceService over the fake db: its DDL is a no-op query here, which is
  // enough to assert the backfill asks for its window's partitions before writing.
  const partitions = new PartitionMaintenanceService(db);
  const poller = new OiLsPoller(
    fakeConfig(opts.symbols ?? ['BTCUSDT']),
    db,
    partitions,
    writers,
    weight,
    metrics,
    streams,
    client,
  );
  return { poller, written, asked, streams, metrics, weight, db };
}

describe('OiLsPoller.pollOnce', () => {
  it('asks all five series per symbol, for the last POLL_LIMIT rows', async () => {
    const { poller, asked } = build({ symbols: ['BTCUSDT', 'ETHUSDT'] });
    await poller.pollOnce(SLOT_TS + 20_000);

    expect(asked).toHaveLength(10); // 5 endpoints x 2 symbols — §4.5's weight line
    expect(new Set(asked.map((a) => a.endpoint))).toEqual(
      new Set(['openInterestHist', 'topLongShortPositionRatio', 'topLongShortAccountRatio', 'globalLongShortAccountRatio', 'takerlongshortRatio']),
    );
    expect(asked.every((a) => a.limit === POLL_LIMIT)).toBe(true);
  });

  it('writes one OI row and four long/short rows per symbol, all four kinds', async () => {
    const { poller, written } = build({ symbols: ['BTCUSDT'] });
    const result = await poller.pollOnce(SLOT_TS + 20_000);

    expect(result).toMatchObject({ oi: 1, longShort: 4, failed: [] });
    expect(written.oi).toHaveLength(1);
    expect((written.ls as t.LongShortRow[]).map((r) => r.kind).sort()).toEqual([
      'global_account', 'taker', 'top_account', 'top_position',
    ]);
  });

  it('writes every returned slot, so a lagging symbol cannot lose one', async () => {
    // Measured 2026-09-28: the venue's publication lag is per-symbol and can exceed the +20 s
    // offset. With limit=1, a poll returning 13:50 followed by one returning 14:00 would drop
    // 13:55 for good. Asking for the last few rows and upserting them all closes that.
    const slots = [SLOT_TS - 2 * SLOT, SLOT_TS - SLOT, SLOT_TS];
    const { poller, written } = build({
      symbols: ['LAGGYUSDT'],
      rowsFor: (endpoint) =>
        endpoint === 'takerlongshortRatio'
          ? slots.map(takerRow)
          : endpoint === 'openInterestHist' ? slots.map(oiRow) : slots.map(lsRow),
    });

    const result = await poller.pollOnce(SLOT_TS + 20_000);
    expect(result.oi).toBe(3);
    expect((written.oi as t.OpenInterestRow[]).map((r) => r.ts.getTime()).sort()).toEqual(slots);
  });

  it('records the poll on the stream registry, so /health sees it', async () => {
    const { poller, streams } = build({});
    await poller.pollOnce(SLOT_TS + 20_000);
    expect(streams.snapshot(SLOT_TS + 20_000)[0]).toMatchObject({ id: STREAM_ID, venue: 'binance', lastMessageAgeSec: 0 });
  });

  it('keeps going when one symbol fails, and logs that symbol as a gap', async () => {
    const { poller, written } = build({
      symbols: ['BTCUSDT', 'BROKENUSDT', 'ETHUSDT'],
      rowsFor: (endpoint, symbol) =>
        symbol === 'BROKENUSDT'
          ? new Error('HTTP 500')
          : endpoint === 'takerlongshortRatio' ? [takerRow(SLOT_TS)] : endpoint === 'openInterestHist' ? [oiRow(SLOT_TS)] : [lsRow(SLOT_TS)],
    });

    const result = await poller.pollOnce(SLOT_TS + 20_000);
    expect(result.failed).toEqual(['BROKENUSDT']);
    expect(result.oi).toBe(2); // the other two still wrote
    const gaps = written.gaps as t.CollectorGapRow[];
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ stream: STREAM_ID, symbol: 'BROKENUSDT', expected: 1, repaired: 0 });
  });

  it('exposes the weight as a LIVE reading, which decays instead of going stale', async () => {
    // Caught on the acceptance run: the gauge was set at the end of each poll and then held that
    // figure for the whole five minutes to the next one, long after those calls had aged out of
    // the trailing minute. It now reads the tracker at the instant it is asked.
    const { metrics, weight } = build({ symbols: ['BTCUSDT', 'ETHUSDT'] });
    const t0 = Date.now();
    for (let i = 0; i < 10; i += 1) weight.recordCall(1, t0); // 5 endpoints x 2 symbols
    expect(metrics.getBinanceWeightUsed1m()).toBe(10);

    jest.spyOn(Date, 'now').mockReturnValue(t0 + 61_000);
    try {
      expect(metrics.getBinanceWeightUsed1m()).toBe(0); // the calls have aged out
    } finally {
      jest.spyOn(Date, 'now').mockRestore();
    }
  });
});

describe('OiLsPoller.backfill', () => {
  const now = SLOT_TS + 20_000;

  it('backfills only the symbols whose newest stored slot is stale', async () => {
    const db = new FakeDb({ FRESHUSDT: new Date(now - 60_000), STALEUSDT: new Date(now - 3 * SLOT), NEWUSDT: null });
    const { poller, asked } = build({ symbols: ['FRESHUSDT', 'STALEUSDT', 'NEWUSDT'], db });

    const result = await poller.backfill(now);
    expect(result.symbols).toBe(2);
    const symbols = new Set(asked.map((a) => a.symbol));
    expect(symbols).toEqual(new Set(['STALEUSDT', 'NEWUSDT']));
    expect(symbols.has('FRESHUSDT')).toBe(false);
  });

  it('creates the partitions for the window before writing into it', async () => {
    // Caught live on the first real run: boot maintenance only prepares the current month + 3,
    // so a 30-day backfill reaching into last month had nowhere to land and died on
    // `no partition of relation "open_interest_5m" found for row` (IB-004: no DEFAULT partition).
    const statements: string[] = [];
    class RecordingDb extends FakeDb {
      async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
        statements.push(sql);
        return super.query<T>(sql, params);
      }
    }
    const { poller } = build({ symbols: ['STALEUSDT'], db: new RecordingDb({ STALEUSDT: null }) });
    await poller.backfill(now);

    const created = statements.filter((sql) => sql.startsWith('create table if not exists open_interest_5m_'));
    expect(created.length).toBeGreaterThanOrEqual(2); // this month and the one 30 days back
    const firstWrite = statements.findIndex((sql) => sql.startsWith('insert into open_interest_5m'));
    const lastCreate = statements.map((s) => s.startsWith('create table if not exists')).lastIndexOf(true);
    expect(lastCreate).toBeLessThan(firstWrite === -1 ? Number.MAX_SAFE_INTEGER : firstWrite);
  });

  it('pages all five series per stale symbol', async () => {
    const db = new FakeDb({ STALEUSDT: null });
    const { poller, asked } = build({ symbols: ['STALEUSDT'], db });
    await poller.backfill(now);
    expect(asked).toHaveLength(5);
  });

  it('records a hole inside what the venue served', async () => {
    // Stored: ...:00, :05, [:10 missing], :15 — a real hole, inside the served range.
    const stored = [
      new Date(SLOT_TS - 3 * SLOT), new Date(SLOT_TS - 2 * SLOT), new Date(SLOT_TS),
    ];
    const db = new FakeDb({ STALEUSDT: null }, stored);
    const { poller, written } = build({ symbols: ['STALEUSDT'], db });
    await poller.backfill(now);

    const gaps = written.gaps as t.CollectorGapRow[];
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      stream: STREAM_ID, symbol: 'STALEUSDT', venue: 'binance', market: 'perp', expected: 1, repaired: 0,
    });
    expect(gaps[0].gapFrom.getTime()).toBe(SLOT_TS - SLOT);
  });

  it('does NOT record the retention edge as a gap', async () => {
    // The window asks from now-30d, but the venue's oldest row is far newer — the edge drifts
    // between asking and answering. Observed on the first live run as exactly one phantom gap
    // per symbol, which would have put 30 false gaps a day into the §6.2 report.
    const stored = [new Date(SLOT_TS - SLOT), new Date(SLOT_TS)];
    const db = new FakeDb({ STALEUSDT: null }, stored);
    const { poller, written } = build({ symbols: ['STALEUSDT'], db });
    await poller.backfill(now);
    expect(written.gaps).toHaveLength(0);
  });

  it('records the whole window when the venue returned nothing for a symbol', async () => {
    // No edge to anchor to, and a symbol with no data at all is a real failure: stay visible.
    const db = new FakeDb({ STALEUSDT: null }, []);
    const { poller, written } = build({ symbols: ['STALEUSDT'], db });
    await poller.backfill(now);

    const gaps = written.gaps as t.CollectorGapRow[];
    expect(gaps).toHaveLength(1);
    expect(gaps[0].error).toMatch(/returned no rows/);
    expect(gaps[0].expected).toBeGreaterThan(8000); // ~30 days of 5-minute slots
  });

  it('reports no gap when the stored grid is complete', async () => {
    const stored: Date[] = [];
    // A full 30-day grid would be 8640 slots; the poller asks from now-30d+1slot, so build that.
    for (let ts = now - 30 * 24 * 60 * 60_000 + SLOT; ts <= now; ts += SLOT) stored.push(new Date(Math.floor(ts / SLOT) * SLOT));
    const db = new FakeDb({ STALEUSDT: null }, stored);
    const { poller, written } = build({ symbols: ['STALEUSDT'], db });

    await poller.backfill(now);
    expect(written.gaps).toHaveLength(0);
  });
});

describe('OiLsPoller.backfill — a hole is registered once, and repaired when it arrives (IB-BUG-020)', () => {
  const now = SLOT_TS + 20_000;
  /** A db that also remembers `collector_gaps` across boots: what one boot writes, the next one reads. */
  class LedgerDb extends FakeDb {
    gaps: Array<{ id: string; detected_at: Date; gap_from: Date; gap_to: Date; expected: number; repaired: number }> = [];
    updates: unknown[][] = [];
    constructor(private storedNow: () => Date[]) { super({ STALEUSDT: null }); }
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      if (sql.includes('select ts from open_interest_5m')) return this.storedNow().map((ts) => ({ ts })) as T[];
      // IB-104's classification read: the open windows, with no neighbour stored (a one-symbol universe)
      if (sql.includes('generate_series')) {
        return this.gaps.filter((g) => g.repaired < g.expected).map(() => ({ error: 'not returned by the venue inside its retention window', min_neighbours: 0 })) as T[];
      }
      if (sql.includes('from collector_gaps')) return this.gaps as T[];
      if (sql.startsWith('update collector_gaps')) {
        this.updates.push([...params]);
        const g = this.gaps.find((x) => x.id === params[0]);
        if (g) g.repaired = params[2] as number;
        return [] as T[];
      }
      return super.query<T>(sql, params);
    }
  }
  /** One boot over the same db; the gaps it writes are added to the db as the writer would. */
  async function boot(db: LedgerDb) {
    const onGaps = (rows: t.CollectorGapRow[]) => {
      for (const g of rows) db.gaps.push({ id: String(db.gaps.length + 1), detected_at: g.detectedAt, gap_from: g.gapFrom, gap_to: g.gapTo, expected: g.expected, repaired: g.repaired ?? 0 });
    };
    const { poller, written, streams } = build({ symbols: ['STALEUSDT'], db, onGaps });
    await poller.backfill(now);
    return { written: written.gaps as t.CollectorGapRow[], open: streams.snapshot().find((s) => s.id === STREAM_ID)?.gapsOpen };
  }
  // the venue serves :00, :05, :15 — the :10 slot never comes (a closed TradFi session)
  const withHole = () => [new Date(SLOT_TS - 3 * SLOT), new Date(SLOT_TS - 2 * SLOT), new Date(SLOT_TS)];

  it('a venue that answers empty for a slot: ONE row over three boots, not one per boot', async () => {
    const db = new LedgerDb(withHole);
    const counts: number[] = [];
    for (let i = 0; i < 3; i += 1) counts.push((await boot(db)).written.length);
    expect(counts).toEqual([1, 0, 0]);
    expect(db.gaps).toHaveLength(1);
    expect(db.gaps[0].repaired).toBe(0);
  });

  it('health counts that hole as open on every boot, including the ones that wrote nothing', async () => {
    const db = new LedgerDb(withHole);
    expect((await boot(db)).open).toBe(1);
    expect((await boot(db)).open).toBe(1);
  });

  it('a venue that LATER returns the slot: the row is repaired and health shows it closed', async () => {
    let stored = withHole();
    const db = new LedgerDb(() => stored);
    await boot(db);
    stored = [...stored, new Date(SLOT_TS - SLOT)]; // the :10 slot arrives
    const second = await boot(db);
    expect(second.written).toHaveLength(0);
    expect(db.updates).toEqual([['1', db.gaps[0].detected_at, 1]]);
    expect(db.gaps[0].repaired).toBe(1);
    expect(second.open).toBe(0);
  });
});

describe('OiLsPoller.backfill — the trailing edge (IB-BUG-020)', () => {
  const now = SLOT_TS + 20_000;
  const grid = (firstSlot: number, lastSlot: number) => {
    const out: Date[] = [];
    for (let ts = firstSlot; ts <= lastSlot; ts += SLOT) out.push(new Date(ts));
    return out;
  };

  it('the newest POLL_LIMIT slots not yet published at boot are NOT a gap: the 5-minute loop fetches them', async () => {
    // the venue's newest row is two slots behind `now`'s slot: its publication lag (QQQUSDT 18:00 on the box)
    const db = new FakeDb({ STALEUSDT: null }, grid(SLOT_TS - 40 * SLOT, SLOT_TS - 2 * SLOT));
    const { poller, written } = build({ symbols: ['STALEUSDT'], db });
    await poller.backfill(now);
    expect(written.gaps).toHaveLength(0);
  });

  it('a symbol the venue stopped serving well before that IS still reported, up to the poll\'s reach', async () => {
    const db = new FakeDb({ STALEUSDT: null }, grid(SLOT_TS - 40 * SLOT, SLOT_TS - 10 * SLOT));
    const { poller, written } = build({ symbols: ['STALEUSDT'], db });
    await poller.backfill(now);
    const gaps = written.gaps as t.CollectorGapRow[];
    expect(gaps).toHaveLength(1);
    expect(gaps[0].gapFrom.getTime()).toBe(SLOT_TS - 9 * SLOT);
    expect(gaps[0].gapTo.getTime()).toBe(SLOT_TS - POLL_LIMIT * SLOT);
  });
});

/**
 * IB-109 (OI divergence design V3) — the poller collects universe ∪ the enabled `alert_symbols`,
 * read at the start of every pass: a coin added between passes is polled in the next one and gets
 * the 30-day backfill once; a removed coin stops; an unreadable list keeps the last one.
 */
class ListDb extends FakeDb {
  listed: string[] = [];
  failList = false;
  constructor(last: Record<string, Date | null>) {
    super(last);
  }
  override async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    if (sql.includes('from alert_symbols')) {
      if (this.failList) throw new Error('relation "alert_symbols" is locked');
      return this.listed.map((symbol) => ({ symbol })) as T[];
    }
    return super.query<T>(sql, params);
  }
}

describe('OiLsPoller — universe ∪ alert list, without a deploy (IB-109)', () => {
  const now = SLOT_TS + 20_000;
  const polled = (asked: Array<{ symbol: string; limit?: number }>) => [...new Set(asked.filter((a) => a.limit === POLL_LIMIT).map((a) => a.symbol))];
  const backfilled = (asked: Array<{ symbol: string; limit?: number }>) => [...new Set(asked.filter((a) => a.limit === undefined).map((a) => a.symbol))];

  it('a coin added between passes is polled in the next pass and backfilled once; removed, it stops', async () => {
    const db = new ListDb({ BTCUSDT: new Date(now - 60_000), TRXUSDT: null });
    const { poller, asked } = build({ symbols: ['BTCUSDT'], db });
    await poller.backfill(now); // boot: BTC fresh, nothing listed
    await poller.pollOnce(now);
    expect(polled(asked)).toEqual(['BTCUSDT']);
    expect(backfilled(asked)).toEqual([]);

    db.listed = ['TRXUSDT']; // the admin adds TRX
    asked.length = 0;
    await poller.pollOnce(now + SLOT);
    await poller.queueBackfillForNew([], now + SLOT); // the backfill runs queued, after the pass: wait for it
    expect(polled(asked)).toEqual(['BTCUSDT', 'TRXUSDT']);
    expect(asked.filter((a) => a.symbol === 'TRXUSDT' && a.limit === POLL_LIMIT)).toHaveLength(5); // one per endpoint
    expect(backfilled(asked)).toEqual(['TRXUSDT']);
    expect(asked.filter((a) => a.symbol === 'TRXUSDT' && a.limit === undefined)).toHaveLength(5); // all five series walked

    asked.length = 0;
    await poller.pollOnce(now + 2 * SLOT); // still listed: polled, NOT backfilled again
    await poller.queueBackfillForNew([], now + 2 * SLOT);
    expect(polled(asked)).toEqual(['BTCUSDT', 'TRXUSDT']);
    expect(backfilled(asked)).toEqual([]);

    db.listed = []; // removed (or disabled — the query reads `where enabled`)
    asked.length = 0;
    await poller.pollOnce(now + 3 * SLOT);
    expect(polled(asked)).toEqual(['BTCUSDT']);
  });

  it('a listed coin that already has fresh OI (a universe coin, or one collected before) is not backfilled', async () => {
    // ETH's newest row is a minute before the pass that sees it listed: fresh by then
    const db = new ListDb({ BTCUSDT: new Date(now - 60_000), ETHUSDT: new Date(now + SLOT - 60_000) });
    const { poller, asked } = build({ symbols: ['BTCUSDT'], db });
    await poller.backfill(now);
    db.listed = ['ETHUSDT'];
    asked.length = 0;
    await poller.pollOnce(now + SLOT);
    await poller.queueBackfillForNew([], now + SLOT);
    expect(polled(asked)).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(backfilled(asked)).toEqual([]);
  });

  it('a pass before the boot backfill has listed its symbols backfills nothing (the boot covers them)', async () => {
    const db = new ListDb({ BTCUSDT: null });
    db.listed = ['TRXUSDT'];
    const { poller, asked } = build({ symbols: ['BTCUSDT'], db });
    await poller.pollOnce(now);
    await poller.queueBackfillForNew([], now);
    expect(polled(asked)).toEqual(['BTCUSDT', 'TRXUSDT']);
    expect(backfilled(asked)).toEqual([]);
  });

  it('an unreadable alert list keeps the last one: a database hiccup does not stop a listed coin', async () => {
    const db = new ListDb({ BTCUSDT: new Date(now - 60_000), TRXUSDT: new Date(now - 60_000) });
    db.listed = ['TRXUSDT'];
    const { poller, asked } = build({ symbols: ['BTCUSDT'], db });
    await poller.pollOnce(now);
    db.failList = true;
    asked.length = 0;
    await poller.pollOnce(now + SLOT);
    expect(polled(asked)).toEqual(['BTCUSDT', 'TRXUSDT']);
  });
});
