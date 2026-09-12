import type { Candle, Instrument, InstrumentId, Timeframe } from '@trade-automation/contracts';

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
];

const ONE_MINUTE_MS = 60_000;
const SEED_HISTORY_MINUTES = 60 * 24 * 2; // 2 days of 1m bars per instrument

const STARTING_PRICE: Record<InstrumentId, number> = {
  'binance:BTCUSDT': 62_000,
  'binance:ETHUSDT': 3_200,
  'capitalcom:US100': 19_500,
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
export function generateSeedHistory(instrument: InstrumentId, endOpenTime: number, count = SEED_HISTORY_MINUTES): Candle[] {
  const rng = mulberry32(seedFor(instrument));
  const startPrice = STARTING_PRICE[instrument] ?? 100;
  const startOpenTime = endOpenTime - count * ONE_MINUTE_MS;

  const candles: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
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
