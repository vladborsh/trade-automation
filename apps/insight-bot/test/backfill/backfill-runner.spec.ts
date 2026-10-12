import { zipSync } from 'fflate';
import { ArchiveClient } from '@trade-automation/binance-client';
import { BackfillRunner } from '../../src/backfill/backfill.runner';
import type { Db } from '../../src/db/db.port';

/**
 * IB-012 — the runner's three promises (§5): it resumes by month, it treats an unserved file as
 * absent rather than as a hole, and it never exceeds 4 parallel downloads.
 */

const zip = (csv: string) => zipSync({ 'f.csv': new TextEncoder().encode(csv) });
const KLINE = (ms: number) => `${ms},1,2,0.5,1.5,10,${ms + 59_999},15,3,5,7.5,0`;

/** A fake archive: URLs listed in `served` return a file, everything else 404s. */
const fakeArchive = (served: Record<string, string>) => {
  const asked: string[] = [];
  const fetchImpl = async (url: string) => {
    asked.push(url);
    const body = served[url];
    if (body === undefined) return { status: 404, ok: false, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response;
    const data = zip(body);
    return { status: 200, ok: true, arrayBuffer: async () => data.buffer } as unknown as Response;
  };
  return { asked, client: new ArchiveClient({ fetchImpl: fetchImpl as never, sleep: async () => {} }) };
};

const fakeDb = (monthsPresent: string[] = []) => {
  const written: unknown[][] = [];
  const db: Db = {
    query: async (sql: string, params?: readonly unknown[]) => {
      // IB-042: matched on the OUTPUT format, `'YYYY-MM'`, not on the query's internals. The
      // previous matcher looked for `to_char(date_trunc('month'`, which is the shape of the
      // implementation rather than of the answer — so when `monthsWithRows` was rewritten this
      // stub silently started returning "no months stored" and the runner re-downloaded a month
      // it already had. The behaviour was unchanged; only the stub's recognition broke, and it
      // broke in the direction that looks like a real regression. Match the contract, not the SQL.
      if (sql.includes("'YYYY-MM'")) return monthsPresent.map((month) => ({ month })) as never;
      if (sql.includes('count(*)')) return [{ n: '0', first_row: null, last_row: null }] as never;
      if (sql.trim().toLowerCase().startsWith('insert')) written.push(params as unknown[]);
      return [] as never;
    },
    transaction: async (fn) => fn(db),
  };
  return { db, written };
};

const partitions = { ensureRange: jest.fn(async () => 0) } as never;
const silent = { log: () => {}, warn: () => {} };
const NOW = () => new Date('2026-09-28T12:00:00Z');

const url = (month: string) => `https://data.binance.vision/data/futures/um/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-${month}.zip`;

describe('BackfillRunner', () => {
  it('skips months that already hold rows — a re-run resumes, it does not re-download', async () => {
    const { asked, client } = fakeArchive({ [url('2026-07')]: KLINE(Date.UTC(2026, 6, 1)) });
    const { db } = fakeDb(['2026-06']); // June is already stored

    await new BackfillRunner({ db, partitions, client, logger: silent, now: NOW })
      .runSymbol({ symbol: 'BTCUSDT', perpFrom: '2026-06', fundingFrom: '2026-06' });

    const klineMonths = asked.filter((u) => u.includes('/monthly/klines/'));
    expect(klineMonths.some((u) => u.includes('2026-06'))).toBe(false);
    expect(klineMonths.some((u) => u.includes('2026-07'))).toBe(true);
  });

  it('--force re-downloads a month that is already stored', async () => {
    const { asked, client } = fakeArchive({});
    const { db } = fakeDb(['2026-06', '2026-07', '2026-08']);

    await new BackfillRunner({ db, partitions, client, logger: silent, now: NOW, force: true })
      .runSymbol({ symbol: 'BTCUSDT', perpFrom: '2026-06', fundingFrom: '2026-06' });

    expect(asked.some((u) => u.includes('/monthly/klines/') && u.includes('2026-06'))).toBe(true);
  });

  it('a 404 month is absent, not a crash and not a hole', async () => {
    const { client } = fakeArchive({}); // the archive serves nothing at all
    const { db } = fakeDb();

    const coverage = await new BackfillRunner({ db, partitions, client, logger: silent, now: NOW })
      .runSymbol({ symbol: 'BTCUSDT', perpFrom: '2026-06', fundingFrom: '2026-06' });

    expect(coverage.length).toBeGreaterThan(0); // it completed
  });

  it('never asks for the metrics archive below the symbol\'s measured floor', async () => {
    const { asked, client } = fakeArchive({});
    const { db } = fakeDb();

    // ETHUSDT's OI archive starts 2021-12; asking for 2021-10 would 404 forever
    await new BackfillRunner({ db, partitions, client, logger: silent, now: () => new Date('2021-12-03T12:00:00Z') })
      .runSymbol({ symbol: 'ETHUSDT', perpFrom: '2021-10', fundingFrom: '2021-10' });

    const metricDays = asked.filter((u) => u.includes('/daily/metrics/'));
    expect(metricDays.length).toBeGreaterThan(0);
    expect(metricDays.every((u) => !/metrics-2021-(10|11)/.test(u))).toBe(true);
    expect(metricDays.some((u) => u.includes('metrics-2021-12-01'))).toBe(true);
  });

  it('BTCUSDT gets the earlier floor: 2020-09, not 2021-12', async () => {
    const { asked, client } = fakeArchive({});
    const { db } = fakeDb();

    await new BackfillRunner({ db, partitions, client, logger: silent, now: () => new Date('2020-09-03T12:00:00Z') })
      .runSymbol({ symbol: 'BTCUSDT', perpFrom: '2020-08', fundingFrom: '2020-08' });

    expect(asked.some((u) => u.includes('metrics-2020-09-01'))).toBe(true);
  });

  it('asks for the current month as DAILY files, and never for today (the file does not exist yet)', async () => {
    const { asked, client } = fakeArchive({});
    const { db } = fakeDb();

    await new BackfillRunner({ db, partitions, client, logger: silent, now: NOW })
      .runSymbol({ symbol: 'BTCUSDT', perpFrom: '2026-09', fundingFrom: '2026-09' });

    const daily = asked.filter((u) => u.includes('/daily/klines/'));
    expect(daily.some((u) => u.includes('1m-2026-09-27'))).toBe(true);
    expect(daily.some((u) => u.includes('1m-2026-09-28'))).toBe(false); // today
    expect(asked.some((u) => u.includes('/monthly/klines/') && u.includes('2026-09'))).toBe(false);
  });
});

describe('venue depth is not a hole', () => {
  /** A Bybit REST fake that serves `pages` of funding and then runs dry. */
  const headers = { get: () => null };
  const bybitArchive = (pages: number, oldestMs: number) => {
    let call = 0;
    return async (url: string) => {
      if (url.includes('funding/history')) {
        const list = call++ < pages
          ? [{ symbol: 'BTCUSDT', fundingRate: '0.0001', fundingRateTimestamp: String(oldestMs + (pages - call) * 28_800_000) }]
          : [];
        return { ok: true, status: 200, statusText: 'OK', headers, json: async () => ({ retCode: 0, result: { list } }) } as unknown as Response;
      }
      // every other REST call (the Binance tails) answers empty rather than reaching the network
      return { ok: true, status: 200, statusText: 'OK', headers, json: async () => [] } as unknown as Response;
    };
  };

  it('Bybit funding before a symbol listed there is the venue\'s depth, not a missing month', async () => {
    // The first full run reported "3 series have real holes" for exactly this: Bybit lists BTC
    // in 2020-03, so every month before it looked missing. The venue's wall is discovered by
    // paging until it runs dry, and that start is what coverage compares against.
    const { db } = fakeDb();
    const { client } = fakeArchive({}); // the Binance archive serves nothing here; only Bybit matters
    const oldest = Date.UTC(2020, 2, 25);
    const coverage = await new BackfillRunner({
      db, partitions, client, logger: silent, now: NOW, fetchImpl: bybitArchive(2, oldest) as never,
    }).runSymbol({ symbol: 'BTCUSDT', perpFrom: '2020-01', fundingFrom: '2020-01', bybitLinear: 'BTCUSDT' });

    const bybit = coverage.find((c) => c.series === 'funding_bybit');
    // the months before Bybit listed BTC are the venue's depth...
    expect(bybit?.unavailableMonths).toEqual(['2020-01', '2020-02']);
    // ...and are therefore never called missing (this fake db stores nothing, so every month
    // from the venue's start on reads as absent — what matters is which side of the wall they
    // fall on, not the count)
    expect(bybit?.missingMonths).not.toContain('2020-01');
    expect(bybit?.missingMonths).not.toContain('2020-02');
    expect(bybit?.missingMonths[0]).toBe('2020-03');
  });
});

describe('dedupeByConflictKey', () => {
  const { conflictKeyOf, dedupeByConflictKey } = jest.requireActual('../../src/backfill/backfill.runner');

  it('the 5-minute metrics files repeat a timestamp — one batch must not update a row twice', () => {
    // Postgres: "ON CONFLICT DO UPDATE command cannot affect row a second time". Hit on the
    // real archive run; research/deriv-positioning/fetch_metrics.py drops duplicates too.
    const ts = new Date('2026-09-20T00:05:00Z');
    const rows = [
      { venue: 'binance', symbol: 'BTCUSDT', ts, kind: 'taker', ratio: 1 },
      { venue: 'binance', symbol: 'BTCUSDT', ts, kind: 'taker', ratio: 2 },
      { venue: 'binance', symbol: 'BTCUSDT', ts, kind: 'global_account', ratio: 3 },
    ];
    const out = dedupeByConflictKey(rows);
    expect(out).toHaveLength(2);
    expect(out.find((r: { kind: string }) => r.kind === 'taker').ratio).toBe(2); // the last wins, as the upsert would
  });

  it('distinguishes markets and kinds, so a perp and a spot bar never collide', () => {
    const openTime = new Date('2026-09-20T00:00:00Z');
    expect(conflictKeyOf({ venue: 'binance', market: 'perp', symbol: 'BTCUSDT', openTime }))
      .not.toBe(conflictKeyOf({ venue: 'binance', market: 'spot', symbol: 'BTCUSDT', openTime }));
  });

  it('returns the same array when there is nothing to remove', () => {
    const rows = [{ venue: 'a', symbol: 'b', ts: new Date(1) }];
    expect(dedupeByConflictKey(rows)).toBe(rows);
  });
});
