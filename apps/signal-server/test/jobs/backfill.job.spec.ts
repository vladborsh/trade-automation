import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EMPTY, Observable } from 'rxjs';
import { Candle, Instrument, Timeframe, Venue, VenueStatus } from '@trade-automation/contracts';
import { BackfillClock, RETRY_BACKOFF_MS, backfill1m, backfillAndDerive, parseBackfillArgs } from '../../src/jobs/backfill.job';
import { CapComPriceNotFoundError } from '../../src/market-data/capitalcom/capitalcom.adapter';
import { VenueAdapter } from '../../src/market-data/venue-adapter.port';
import { CandleStore } from '../../src/storage/candle-store.port';
import { FileCandleStore } from '../../src/storage/file/file-candle-store';

/**
 * T-031 — the 1m backfill job (architecture/backtest-app-system-design.md §10) against a stub
 * venue and a fake clock: throttle, page boundaries, the vendor floors, resume after an interrupted
 * run, idempotency, forward mode, retries, and the derive run afterwards. No network: the
 * adapter-level spec (backfill.adapters.spec.ts) drives the real adapters over loopback.
 */
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const BTC: Instrument = {
  id: 'binance:BTCUSDT', venue: 'binance', symbol: 'BTCUSDT', assetClass: 'crypto-perp', displayName: 'BTC',
  pricePrecision: 2, quoteCurrency: 'USDT', sessionCurrency: 'USD', sessionTimezone: 'UTC',
} as Instrument;
const EURUSD: Instrument = {
  id: 'capitalcom:EURUSD', venue: 'capitalcom', symbol: 'EURUSD', assetClass: 'forex-cfd', displayName: 'EUR/USD',
  pricePrecision: 5, quoteCurrency: 'USD', sessionCurrency: 'USD', sessionTimezone: 'UTC',
} as Instrument;

class FakeClock implements BackfillClock {
  sleeps: number[] = [];
  constructor(public t: number) {}
  now(): number {
    return this.t;
  }
  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.t += ms;
  }
}

interface StubOptions {
  /** No bars before this (Binance: the listing). */
  listingMs?: number;
  /** Capital.com: 404 for any window ending before this. */
  notFoundBeforeMs?: number;
  /** No bars on Saturdays and Sundays (UTC), like an FX CFD. */
  weekendsClosed?: boolean;
  /** Each call takes this long on the fake clock. */
  latencyMs?: number;
  /** Call numbers (1-based) that throw a transient error. */
  failCalls?: Set<number>;
  /** From this call number on, every call throws. */
  deadFromCall?: number;
}

/** A venue with a bar every minute (prices encode the minute) and a forming bar at "now". */
class StubVenue implements VenueAdapter {
  calls: { from: number; to: number; at: number }[] = [];
  constructor(
    readonly venue: Venue,
    private readonly clock: FakeClock,
    private readonly opts: StubOptions = {},
  ) {}

  async fetchCandles(instrument: Instrument, tf: Timeframe, from: number, to: number): Promise<Candle[]> {
    this.calls.push({ from, to, at: this.clock.now() });
    const n = this.calls.length;
    this.clock.t += this.opts.latencyMs ?? 0;
    if (this.opts.failCalls?.has(n) || (this.opts.deadFromCall !== undefined && n >= this.opts.deadFromCall)) {
      throw new Error('stub venue: 503 Service Unavailable');
    }
    if (this.opts.notFoundBeforeMs !== undefined && to < this.opts.notFoundBeforeMs) throw new CapComPriceNotFoundError('stub: no data');
    const nowMinute = Math.floor(this.clock.now() / MIN) * MIN;
    const out: Candle[] = [];
    for (let t = from; t <= to && t <= nowMinute; t += MIN) {
      if (t < (this.opts.listingMs ?? Number.NEGATIVE_INFINITY)) continue;
      const weekday = new Date(t).getUTCDay();
      if (this.opts.weekendsClosed && (weekday === 0 || weekday === 6)) continue;
      out.push(bar(instrument, t, t === nowMinute ? 'forming' : 'closed'));
    }
    return out;
  }

  streamCandles(): Observable<Candle> {
    return EMPTY;
  }

  health(): Observable<VenueStatus> {
    return EMPTY;
  }
}

function bar(instrument: Instrument, openTime: number, kind: 'closed' | 'forming'): Candle {
  const p = 100 + (openTime / MIN) % 1000;
  // Binance's REST mapper marks every row closed, the forming one too: the job must cap at the last closed minute
  return {
    instrument: instrument.id, timeframe: '1m', openTime, open: p, high: p + 1, low: p - 1, close: kind === 'forming' ? -1 : p,
    volume: 1, closed: true, source: 'venue-rest',
  };
}

/** A store that remembers each upsert batch. */
function spied(store: FileCandleStore): { store: CandleStore; batches: Candle[][] } {
  const batches: Candle[][] = [];
  const s = Object.create(store) as CandleStore;
  s.upsert = async (candles) => {
    batches.push(candles);
    return store.upsert(candles);
  };
  return { store: s, batches };
}

function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out[path.relative(root, full)] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return out;
}

const NOW = Date.UTC(2026, 0, 8, 12, 0, 30); // Thursday 12:00:30: the last closed minute is 11:59
const LAST_CLOSED = Date.UTC(2026, 0, 8, 11, 59);
const LISTING = Date.UTC(2026, 0, 5, 6, 0); // 3 days 6 h of history = 4680 bars

describe('backfill1m (T-031, design §10)', () => {
  let root: string;
  let file: FileCandleStore;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-'));
    file = new FileCandleStore(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const stored = (i: Instrument = BTC) => file.query(i.id, '1m', 0, NOW + DAY);

  it('Binance, backward: from the last closed minute to the listing, in exact 1500-minute pages, one upsert per UTC day', async () => {
    const clock = new FakeClock(NOW);
    const venue = new StubVenue('binance', clock, { listingMs: LISTING });
    const { store, batches } = spied(file);

    const counts = await backfill1m(store, venue, BTC, {}, { clock });

    // pages: contiguous, going down, each exactly 1500 minutes (both ends inclusive), the first ending at the last closed minute
    expect(venue.calls[0].to).toBe(LAST_CLOSED);
    for (const [k, c] of venue.calls.entries()) {
      expect(c.to - c.from).toBe(1499 * MIN);
      if (k > 0) expect(c.to).toBe(venue.calls[k - 1].from - MIN);
    }
    expect(counts).toMatchObject({ direction: 'backward', requests: 5, candles: 4680, days: 4, stop: 'empty-page', fromMs: LISTING, toMs: LAST_CLOSED });
    const bars = await stored();
    expect(bars).toHaveLength(4680); // every minute once: page edges neither dropped nor doubled
    expect(new Set(bars.map((b) => b.openTime)).size).toBe(4680);
    expect(bars.every((b) => b.close !== -1)).toBe(true); // the forming minute is never written
    for (const batch of batches) expect(new Set(batch.map((b) => Math.floor(b.openTime / DAY))).size).toBe(1); // day batches
    expect(batches.map((b) => new Date(b[0].openTime).toISOString().slice(0, 10))).toEqual(['2026-01-08', '2026-01-07', '2026-01-06', '2026-01-05']);
  });

  it('throttle: never two requests within 1 s, start to start (≤ 60/min = 600 weight/min on Binance); a slow venue is not slowed further', async () => {
    const fast = new FakeClock(NOW);
    const venue = new StubVenue('binance', fast, { listingMs: LISTING });
    await backfill1m(spied(file).store, venue, BTC, {}, { clock: fast });
    const gaps = venue.calls.slice(1).map((c, k) => c.at - venue.calls[k].at);
    expect(gaps.every((g) => g === 1000)).toBe(true); // an instant venue: exactly 1 request/s
    expect(fast.sleeps.every((s) => s <= 1000)).toBe(true);

    fs.rmSync(root, { recursive: true, force: true });
    const slow = new FakeClock(NOW);
    const slowVenue = new StubVenue('binance', slow, { listingMs: LISTING, latencyMs: 1500 });
    await backfill1m(spied(new FileCandleStore(root)).store, slowVenue, BTC, {}, { clock: slow });
    expect(slowVenue.calls.slice(1).map((c, k) => c.at - slowVenue.calls[k].at).every((g) => g === 1500)).toBe(true);
    expect(slow.sleeps).toEqual([]); // already slower than 1/s: no extra wait
  });

  it('Capital.com: 720-minute pages down to the 2024-01-02 floor, no request below it; weekend empty pages do not stop the walk', async () => {
    const now = Date.UTC(2024, 0, 9, 1, 0, 30); // Tuesday 01:00:30 — the walk crosses the 6–7 Jan weekend
    const clock = new FakeClock(now);
    const venue = new StubVenue('capitalcom', clock, { weekendsClosed: true });

    const counts = await backfill1m(spied(file).store, venue, EURUSD, {}, { clock });

    const floor = Date.UTC(2024, 0, 2);
    for (const c of venue.calls) {
      expect(c.from).toBeGreaterThanOrEqual(floor);
      expect(c.to - c.from).toBeLessThanOrEqual(719 * MIN);
    }
    expect(venue.calls.at(-1)!.from).toBe(floor);
    expect(counts.stop).toBe('floor');
    const bars = await stored(EURUSD);
    expect(bars[0].openTime).toBe(floor);
    expect(bars.at(-1)!.openTime).toBe(Date.UTC(2024, 0, 9, 0, 59));
    expect(bars.filter((b) => [0, 6].includes(new Date(b.openTime).getUTCDay()))).toEqual([]);
    expect(bars).toHaveLength(4 * 1440 + 1440 + 60); // Tue 2..Fri 5 (4 days), Mon 8, Tue 9 00:00–00:59
  });

  it('Capital.com: a 404 is the vendor floor', async () => {
    const clock = new FakeClock(Date.UTC(2024, 5, 5, 12, 0, 30));
    const venue = new StubVenue('capitalcom', clock, { notFoundBeforeMs: Date.UTC(2024, 5, 4) });
    const counts = await backfill1m(spied(file).store, venue, EURUSD, {}, { clock });
    expect(counts.stop).toBe('not-found');
    expect((await stored(EURUSD))[0].openTime).toBeGreaterThanOrEqual(Date.UTC(2024, 5, 3));
  });

  it('resume: an interrupted run leaves only complete days; the next run starts right below them and ends identical to one clean run', async () => {
    // the reference: one uninterrupted run
    const refRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-ref-'));
    const refClock = new FakeClock(NOW);
    await backfill1m(new FileCandleStore(refRoot), new StubVenue('binance', refClock, { listingMs: LISTING }), BTC, {}, { clock: refClock });

    // the venue dies at the 3rd page (and stays dead through every retry)
    const clock1 = new FakeClock(NOW);
    const dying = new StubVenue('binance', clock1, { listingMs: LISTING, deadFromCall: 3 });
    await expect(backfill1m(file, dying, BTC, {}, { clock: clock1 })).rejects.toThrow(/503/);
    expect(clock1.sleeps.filter((s) => s > 1000)).toEqual([...RETRY_BACKOFF_MS]); // retried with back-off first
    const partial = await stored();
    const days = new Map<number, number>();
    for (const b of partial) days.set(Math.floor(b.openTime / DAY), (days.get(Math.floor(b.openTime / DAY)) ?? 0) + 1);
    const [top, ...below] = [...days.entries()].sort((a, b) => b[0] - a[0]);
    expect(top[1]).toBe(12 * 60); // 8 Jan 00:00–11:59
    for (const [, n] of below) expect(n).toBe(1440); // only complete days were written
    const coverageFrom = partial[0].openTime;

    const clock2 = new FakeClock(NOW + 10 * MIN);
    const healthy = new StubVenue('binance', clock2, { listingMs: LISTING });
    const counts = await backfill1m(file, healthy, BTC, {}, { clock: clock2 });
    expect(healthy.calls[0].to).toBe(coverageFrom - MIN); // resumes right below the checkpoint
    expect(counts.stop).toBe('empty-page');
    expect(await stored()).toEqual(await new FileCandleStore(refRoot).query(BTC.id, '1m', 0, NOW + DAY));
    fs.rmSync(refRoot, { recursive: true, force: true });
  });

  it('idempotent: a rerun after completion writes nothing (Binance: one empty page; Capital.com: no request at all)', async () => {
    const clock = new FakeClock(NOW);
    await backfill1m(file, new StubVenue('binance', clock, { listingMs: LISTING }), BTC, {}, { clock });
    const before = snapshot(root);
    const again = new StubVenue('binance', clock, { listingMs: LISTING });
    expect(await backfill1m(file, again, BTC, {}, { clock })).toMatchObject({ requests: 1, candles: 0, days: 0, stop: 'empty-page' });
    expect(snapshot(root)).toEqual(before);

    const fx = new FakeClock(Date.UTC(2024, 0, 3, 0, 30, 30));
    await backfill1m(file, new StubVenue('capitalcom', fx), EURUSD, {}, { clock: fx });
    const fxBefore = snapshot(root);
    const fxAgain = new StubVenue('capitalcom', fx);
    expect(await backfill1m(file, fxAgain, EURUSD, {}, { clock: fx })).toMatchObject({ requests: 0, stop: 'nothing-to-do' });
    expect(snapshot(root)).toEqual(fxBefore);
  });

  it('retries a transient failure after the back-off, still throttled, and loses nothing', async () => {
    const clock = new FakeClock(NOW);
    const venue = new StubVenue('binance', clock, { listingMs: LISTING, failCalls: new Set([2]) });
    const counts = await backfill1m(file, venue, BTC, {}, { clock });
    expect(counts).toMatchObject({ requests: 6, retries: 1, candles: 4680 });
    expect(venue.calls[2].from).toBe(venue.calls[1].from); // the same page again
    expect(venue.calls[2].at - venue.calls[1].at).toBe(RETRY_BACKOFF_MS[0]);
  });

  it('forward (--from): refetches from the given day to the last closed minute in ascending pages, through existing coverage', async () => {
    const clock = new FakeClock(NOW);
    await file.upsert([{ ...bar(BTC, Date.UTC(2026, 0, 7, 10, 0), 'closed'), close: 42 }]); // an existing bar inside the range
    const venue = new StubVenue('binance', clock, { listingMs: LISTING });
    const counts = await backfill1m(file, venue, BTC, { fromMs: Date.UTC(2026, 0, 7, 0, 0, 20) }, { clock });

    expect(venue.calls[0].from).toBe(Date.UTC(2026, 0, 7)); // floored to the minute
    for (const [k, c] of venue.calls.entries()) if (k > 0) expect(c.from).toBe(venue.calls[k - 1].to + MIN);
    expect(venue.calls.at(-1)!.to).toBe(LAST_CLOSED);
    expect(counts).toMatchObject({ direction: 'forward', stop: 'now', candles: 1440 + 720, days: 2 });
    expect((await stored()).find((b) => b.openTime === Date.UTC(2026, 0, 7, 10, 0))!.close).not.toBe(42); // refetched
  });

  it('forward on Capital.com is clamped to the 2024-01-02 floor', async () => {
    const clock = new FakeClock(Date.UTC(2024, 0, 2, 1, 0, 30));
    const venue = new StubVenue('capitalcom', clock);
    await backfill1m(file, venue, EURUSD, { fromMs: Date.UTC(2023, 11, 1) }, { clock });
    expect(venue.calls[0].from).toBe(Date.UTC(2024, 0, 2));
  });

  it('backfillAndDerive: derive-timeframes runs afterwards from the earliest day written', async () => {
    const clock = new FakeClock(NOW);
    const { backfill, derived } = await backfillAndDerive(file, new StubVenue('binance', clock, { listingMs: LISTING }), BTC, {}, { clock });
    expect(backfill.candles).toBe(4680);
    expect(derived).toMatchObject({ instrument: BTC.id, candles1m: 4680 });
    const h1 = await file.query(BTC.id, '1h', 0, NOW + DAY);
    expect(h1[0].openTime).toBe(LISTING);
    expect(h1.every((b) => b.source === 'resampled')).toBe(true);
    expect(h1).toHaveLength(3 * 24 + 6 - 1); // closed hours only: 06:00 on the 5th to 10:00 on the 8th
    expect(await file.query(BTC.id, '1d', 0, NOW + DAY)).toHaveLength(3); // 5th (partial, closed by the 6th's first minute), 6th, 7th; the 8th is forming
  });
});

describe('parseBackfillArgs (T-031)', () => {
  it('parses --instrument and --from', () => {
    expect(parseBackfillArgs(['--instrument', 'capitalcom:EURUSD'])).toEqual({ instrument: 'capitalcom:EURUSD' });
    expect(parseBackfillArgs(['--instrument', 'binance:BTCUSDT', '--from', '2024-01-02'])).toEqual({
      instrument: 'binance:BTCUSDT', fromMs: Date.UTC(2024, 0, 2),
    });
  });

  it('requires --instrument; rejects unknown flags, missing values and bad dates', () => {
    expect(() => parseBackfillArgs([])).toThrow(/required/);
    expect(() => parseBackfillArgs(['--instrument', 'x', '--force'])).toThrow(/unknown/);
    expect(() => parseBackfillArgs(['--instrument'])).toThrow(/value/);
    expect(() => parseBackfillArgs(['--instrument', 'x', '--from', 'soon'])).toThrow(/ISO/);
  });
});
