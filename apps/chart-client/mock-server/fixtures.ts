import type { Candle, Instrument, InstrumentId, MetricObservation, Timeframe } from '@trade-automation/contracts';

/** Deterministic PRNG (mulberry32) so fixture runs are reproducible across boots. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FIXTURE_INSTRUMENTS: Instrument[] = [
  {
    id: 'binance:BTCUSDT',
    venue: 'binance',
    symbol: 'BTCUSDT',
    assetClass: 'crypto-perp',
    displayName: 'BTC/USDT Perp',
    pricePrecision: 2,
    quoteCurrency: 'USDT',
    sessionTimezone: 'UTC',
  },
  {
    id: 'binance:ETHUSDT',
    venue: 'binance',
    symbol: 'ETHUSDT',
    assetClass: 'crypto-perp',
    displayName: 'ETH/USDT Perp',
    pricePrecision: 2,
    quoteCurrency: 'USDT',
    sessionTimezone: 'UTC',
  },
  {
    id: 'capitalcom:US100',
    venue: 'capitalcom',
    symbol: 'US100',
    assetClass: 'index-cfd',
    displayName: 'US Tech 100',
    pricePrecision: 1,
    quoteCurrency: 'USD',
    sessionTimezone: 'America/New_York',
  },
  /**
   * architecture/chart-layouts.md §6.7 — the mock has no live Capital.com
   * session to back the real `capitalcom:DXY`/`capitalcom:US500` epics
   * (§5, §9 SE-3 notes), so it stands in with fixture-only ids purely so
   * the client unit and its e2e build/run without the server unit.
   */
  {
    id: 'capitalcom:DXY-MOCK',
    venue: 'capitalcom',
    symbol: 'DXY-MOCK',
    assetClass: 'index-cfd',
    displayName: 'US Dollar Index',
    pricePrecision: 3,
    quoteCurrency: 'USD',
    sessionTimezone: 'UTC',
  },
  {
    id: 'capitalcom:US500-MOCK',
    venue: 'capitalcom',
    symbol: 'US500-MOCK',
    assetClass: 'index-cfd',
    displayName: 'US 500',
    pricePrecision: 1,
    quoteCurrency: 'USD',
    sessionTimezone: 'America/New_York',
  },
];

const ONE_MINUTE_MS = 60_000;
const SEED_HISTORY_MINUTES = 60 * 24 * 2; // 2 days of 1m bars per instrument

// architecture/scroll-back-freeze-diagnosis.md's "loadOlder() pagination trigger unreachable
// at real-data buffer depth" follow-up: the default 2-day seed only produces ~576 5m bars per
// instrument, well under lightweight-charts' zoom-out floor (~1260-1300 bars at typical panel
// widths) — every panel's oldest bar is reachable via a single zoom-drag, which is why this
// class of bug shipped unnoticed. One instrument (opt-in via env vars, so the default mock
// server e2e/dev instances are unaffected) can be seeded far deeper than that floor — e.g.
// ≥7500 minutes for ≥1500 5m bars, matching PanelFeed's real HISTORY_LIMIT — to reproduce a
// real-data-depth buffer in a dedicated e2e scenario without touching the shallow default the
// rest of the suite relies on.
const DEEP_SEED_INSTRUMENT = process.env['MOCK_DEEP_HISTORY_INSTRUMENT'] as InstrumentId | undefined;
const DEEP_SEED_MINUTES = Number(process.env['MOCK_DEEP_HISTORY_MINUTES'] ?? NaN);

function seedMinutesFor(instrument: InstrumentId): number {
  if (DEEP_SEED_INSTRUMENT && instrument === DEEP_SEED_INSTRUMENT && Number.isFinite(DEEP_SEED_MINUTES)) {
    return DEEP_SEED_MINUTES;
  }
  return SEED_HISTORY_MINUTES;
}

const STARTING_PRICE: Record<InstrumentId, number> = {
  'binance:BTCUSDT': 62_000,
  'binance:ETHUSDT': 3_200,
  'capitalcom:US100': 19_500,
  'capitalcom:DXY-MOCK': 104.5,
  'capitalcom:US500-MOCK': 5_600,
};

const STARTING_OPEN_INTEREST: Record<string, number> = {
  'binance:BTCUSDT': 55_000, // BTC contracts outstanding, order-of-magnitude realistic
};

function seedFor(instrument: InstrumentId): number {
  let hash = 0;
  for (let i = 0; i < instrument.length; i++) {
    hash = (hash * 31 + instrument.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Generates a deterministic 1m OHLCV random walk ending at `endOpenTime`
 * (exclusive), `count` bars long — a stand-in for real venue history until
 * SE-1's adapters land. `source: 'storage'` because this plays the role of
 * "what the CandleStore would return".
 */
export function generateSeedHistory(instrument: InstrumentId, endOpenTime: number, count?: number): Candle[] {
  const barCount = count ?? seedMinutesFor(instrument);
  const rng = mulberry32(seedFor(instrument));
  const startPrice = STARTING_PRICE[instrument] ?? 100;
  const startOpenTime = endOpenTime - barCount * ONE_MINUTE_MS;

  const candles: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < barCount; i++) {
    const openTime = startOpenTime + i * ONE_MINUTE_MS;
    const drift = (rng() - 0.5) * startPrice * 0.0015;
    const open = price;
    const close = Math.max(0.01, open + drift);
    const high = Math.max(open, close) + rng() * startPrice * 0.0005;
    const low = Math.min(open, close) - rng() * startPrice * 0.0005;
    const volume = 1 + rng() * 50;
    price = close;
    candles.push({
      instrument,
      timeframe: '1m',
      openTime,
      open,
      high,
      low,
      close,
      volume,
      closed: true,
      source: 'storage',
    });
  }
  return candles;
}

/** Opens a new forming 1m bar right after `previous`, for the live tick loop. */
export function startFormingCandle(instrument: InstrumentId, previous: Candle): Candle {
  return {
    instrument,
    timeframe: '1m',
    openTime: previous.openTime + ONE_MINUTE_MS,
    open: previous.close,
    high: previous.close,
    low: previous.close,
    close: previous.close,
    volume: 0,
    closed: false,
    source: 'venue-stream',
  };
}

/** Nudges a forming bar's OHLC by one more random-walk step; `openTime` never changes. */
export function advanceFormingCandle(instrument: InstrumentId, forming: Candle, tickIndex: number): Candle {
  const rng = mulberry32(forming.openTime + tickIndex + seedFor(instrument));
  const startPrice = STARTING_PRICE[instrument] ?? 100;
  const drift = (rng() - 0.5) * startPrice * 0.0005;
  const close = Math.max(0.01, forming.close + drift);
  return {
    ...forming,
    close,
    high: Math.max(forming.high, close),
    low: Math.min(forming.low, close),
    volume: forming.volume + rng() * 5,
  };
}

/** Marks a forming bar closed — the version that gets persisted to history. */
export function closeCandle(forming: Candle): Candle {
  return { ...forming, closed: true, source: 'venue-stream' };
}

/**
 * architecture/chart-layouts.md §6.7 — a synthetic OI random walk, one
 * observation per closed 1m candle, so `GET /api/metrics` and the `metrics`
 * WS topic have something real to bucket/stream without a live Binance
 * poller. Not a port of the real `BinanceMetricsAdapter` (§4.3) — same
 * relationship `example-cross` has to a real `SignalStrategy`.
 */
export function seedOpenInterestObservations(instrument: InstrumentId, history: readonly Candle[]): MetricObservation[] {
  const startValue = STARTING_OPEN_INTEREST[instrument];
  if (startValue === undefined) {
    return [];
  }
  const rng = mulberry32(seedFor(instrument) + 1); // +1: a different stream from the price walk
  let value = startValue;
  const observations: MetricObservation[] = [];
  for (const candle of history) {
    const drift = (rng() - 0.5) * startValue * 0.002;
    value = Math.max(0, value + drift);
    observations.push({ metric: 'openInterest', instrument, time: candle.openTime, value });
  }
  return observations;
}

/** One more OI observation following the last known value, for the live tick loop. */
export function advanceOpenInterestObservation(
  instrument: InstrumentId,
  previous: MetricObservation,
  time: number,
): MetricObservation {
  const startValue = STARTING_OPEN_INTEREST[instrument] ?? previous.value;
  const rng = mulberry32(time + seedFor(instrument) + 1);
  const drift = (rng() - 0.5) * startValue * 0.002;
  return { metric: 'openInterest', instrument, time, value: Math.max(0, previous.value + drift) };
}

const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
};

/**
 * Resamples closed 1m candles into a coarser timeframe, UTC-boundary
 * aligned — the mock server's stand-in for SE-1's `Resampler` (§4.2), just
 * enough to serve `GET /api/candles?timeframe=...` for tf !== '1m'.
 */
export function resample(oneMinute: readonly Candle[], timeframe: Timeframe): Candle[] {
  if (timeframe === '1m') {
    return oneMinute.slice();
  }
  const bucketMs = TIMEFRAME_MINUTES[timeframe] * ONE_MINUTE_MS;
  const buckets = new Map<number, Candle[]>();
  for (const candle of oneMinute) {
    if (!candle.closed) {
      continue;
    }
    const bucketStart = Math.floor(candle.openTime / bucketMs) * bucketMs;
    const bucket = buckets.get(bucketStart) ?? [];
    bucket.push(candle);
    buckets.set(bucketStart, bucket);
  }
  const result: Candle[] = [];
  for (const [openTime, bucket] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const ordered = bucket.slice().sort((a, b) => a.openTime - b.openTime);
    result.push({
      instrument: ordered[0].instrument,
      timeframe,
      openTime,
      open: ordered[0].open,
      high: Math.max(...ordered.map((c) => c.high)),
      low: Math.min(...ordered.map((c) => c.low)),
      close: ordered[ordered.length - 1].close,
      volume: ordered.reduce((sum, c) => sum + c.volume, 0),
      closed: true,
      source: 'resampled',
    });
  }
  return result;
}
