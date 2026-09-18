import type {
  AggregateMemberValue,
  AggregateMetricPoint,
  InstrumentId,
  MetricAggregate,
  MetricOhlc,
  Timeframe,
} from '@trade-automation/contracts';
import { TIMEFRAME_MS } from '@trade-automation/contracts';

/**
 * architecture/aggregate-oi.md — the mock's `btc-perp-oi` aggregate (SE-AG4). A SCENARIO, not a
 * port of the server: which venues are in each 5 min slot is scripted below, so every case the
 * client must draw honestly is on screen at boot, relative to the wall clock:
 *
 *   now − 45 d … now − 30 d   Bybit only                      (partial epoch)
 *   now − 30 d … now − 2 d    Binance + Bybit                 (partial epoch, `+Binance` seam)
 *   now − 2 d  … now          all three                       (complete, `+Hyperliquid` seam)
 *     now − 20 h, 1 hour      Hyperliquid outage              (partial epoch, `−Hyperliquid` / `+Hyperliquid`)
 *     now − 8 h, 2 slots      Hyperliquid blip, ALREADY DROPPED (no sample at all → whitespace, §1 C3)
 *   live, every tick          all three, 1 min samples       (the forming bucket, `metricAggregates` WS)
 *
 * Coverage per slot is scripted, so rules C1–C3 are NOT re-implemented here (SE-AG3 owns them in
 * contracts' `aggregateObservations`). `bucketScenario` below only turns the scripted samples into
 * timeframe buckets the way §1 C4–C5 say (bucket coverage = closing sample's; open from the previous
 * bucket only across the same coverage) — replace it with `aggregateObservations` once SE-AG3 merges.
 */

const BINANCE: InstrumentId = 'binance:BTCUSDT';
const BYBIT: InstrumentId = 'bybit:BTCUSDT';
const HYPERLIQUID: InstrumentId = 'hyperliquid:BTC';

export const MOCK_AGGREGATE: MetricAggregate = {
  id: 'btc-perp-oi',
  displayName: 'BTC perps · 3 venues',
  metric: 'openInterest',
  countingConvention: 'one-sided',
  members: [
    { id: BINANCE, venue: 'binance', symbol: 'BTCUSDT', quoteCurrency: 'USDT' },
    { id: BYBIT, venue: 'bybit', symbol: 'BTCUSDT', quoteCurrency: 'USDT' },
    { id: HYPERLIQUID, venue: 'hyperliquid', symbol: 'BTC', quoteCurrency: 'USDC' },
  ],
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SLOT_MS = 5 * MIN; // history grain (§1 C1)

/** Today's one-sided BTC figures from §0 (Binance 107.6 k, Bybit 28.4 k, Hyperliquid 36.5 k). */
const BASE_OI: Record<string, number> = { [BINANCE]: 107_600, [BYBIT]: 28_400, [HYPERLIQUID]: 36_500 };

interface Sample {
  time: number;
  legs: AggregateMemberValue[]; // sorted by source; coverage = their sources
}

/** Deterministic, smooth-ish OI per leg and one mark price: the same `t` always reads the same. */
function legAt(source: InstrumentId, t: number): AggregateMemberValue {
  const phase = source.length;
  const h = t / HOUR;
  const value = BASE_OI[source] * (1 + 0.04 * Math.sin(h / 30 + phase) + 0.012 * Math.sin(h / 2.3 + phase * 2) + 0.004 * Math.sin(h * 1.7));
  const mark = 78_000 * (1 + 0.06 * Math.sin(h / 90) + 0.01 * Math.sin(h / 5));
  return { source, value, notional: value * mark };
}

function coverageKey(s: Sample): string {
  return s.legs.map((l) => l.source).join(',');
}

function sum(legs: readonly AggregateMemberValue[], field: 'value' | 'notional'): number {
  return legs.reduce((acc, l) => acc + (l[field] ?? 0), 0);
}

function ohlc(open: number, values: readonly number[]): MetricOhlc {
  const all = [open, ...values];
  return { open, high: Math.max(...all), low: Math.min(...all), close: values[values.length - 1] };
}

export class MockAggregateOi {
  private readonly history: Sample[] = [];
  /** Live samples keyed by 1 min slot — the forming bucket's source (Hyperliquid's poll cadence, §6). */
  private readonly live = new Map<number, Sample>();

  constructor(now: number) {
    const lastSlot = Math.floor(now / SLOT_MS) * SLOT_MS - SLOT_MS;
    const binanceFrom = now - 30 * DAY;
    const hyperliquidFrom = now - 2 * DAY;
    const outageFrom = Math.floor((now - 20 * HOUR) / SLOT_MS) * SLOT_MS;
    const blipFrom = Math.floor((now - 8 * HOUR) / SLOT_MS) * SLOT_MS;
    for (let t = Math.floor((now - 45 * DAY) / SLOT_MS) * SLOT_MS; t <= lastSlot; t += SLOT_MS) {
      if (t >= blipFrom && t < blipFrom + 2 * SLOT_MS) {
        continue; // §1 C3: a 2-slot Hyperliquid miss is dropped, never drawn as a dip
      }
      const members = [BYBIT];
      if (t >= binanceFrom) members.push(BINANCE);
      if (t >= hyperliquidFrom && !(t >= outageFrom && t < outageFrom + HOUR)) members.push(HYPERLIQUID);
      this.history.push({ time: t, legs: members.sort().map((m) => legAt(m, t)) });
    }
  }

  /** One live poll round at `now`: every member answered (the forming bucket is complete). */
  tick(now: number): void {
    this.live.set(Math.floor(now / MIN) * MIN, {
      time: now,
      legs: MOCK_AGGREGATE.members.map((m) => m.id).sort().map((id) => legAt(id, now)),
    });
  }

  /** `GET /api/metric-aggregates/points` — with the lead bucket read and dropped, like `/api/metrics`. */
  points(tf: Timeframe, from: number, to: number, limit: number): AggregateMetricPoint[] {
    const tfMs = TIMEFRAME_MS[tf];
    const firstBucket = Math.floor(from / tfMs) * tfMs;
    const leadFrom = firstBucket - tfMs;
    const samples = [...this.history, ...this.live.values()].filter((s) => s.time >= leadFrom && s.time <= to);
    const points = bucketScenario(samples, tf).filter((p) => p.time >= firstBucket);
    return points.slice(Math.max(0, points.length - limit));
  }

  /** The forming bucket containing `now`, as the `metricAggregates` topic sends it. */
  formingPoint(tf: Timeframe, now: number): AggregateMetricPoint | null {
    const bucketStart = Math.floor(now / TIMEFRAME_MS[tf]) * TIMEFRAME_MS[tf];
    const last = this.points(tf, bucketStart, now, 1).at(-1);
    return last && last.time === bucketStart ? last : null;
  }
}

/** Scripted samples (ascending) → buckets per §1 C1 (last-in-grain), C4, C5. See the file header. */
function bucketScenario(samples: readonly Sample[], tf: Timeframe): AggregateMetricPoint[] {
  const tfMs = TIMEFRAME_MS[tf];
  const grainMs = Math.min(tfMs, SLOT_MS);
  const grained = new Map<number, Sample>();
  for (const s of samples) grained.set(Math.floor(s.time / grainMs) * grainMs, s);

  const buckets = new Map<number, Sample[]>();
  for (const [grain, s] of [...grained.entries()].sort(([a], [b]) => a - b)) {
    const bucket = Math.floor(grain / tfMs) * tfMs;
    const list = buckets.get(bucket);
    if (list) list.push(s);
    else buckets.set(bucket, [s]);
  }

  const out: AggregateMetricPoint[] = [];
  let previous: { time: number; key: string; point: AggregateMetricPoint } | null = null;
  for (const [time, all] of buckets) {
    const closing = all[all.length - 1];
    const key = coverageKey(closing);
    const kept = all.filter((s) => coverageKey(s) === key); // C4: never mix coverage in a bucket
    const carry = previous !== null && previous.key === key && previous.time === time - tfMs; // C5
    const values = kept.map((s) => sum(s.legs, 'value'));
    const notionals = kept.map((s) => sum(s.legs, 'notional'));
    const coverage = closing.legs.map((l) => l.source);
    const point: AggregateMetricPoint = {
      aggregate: MOCK_AGGREGATE.id,
      metric: 'openInterest',
      timeframe: tf,
      time,
      unit: 'base',
      value: values[values.length - 1],
      ohlc: ohlc(carry ? previous!.point.ohlc.close : values[0], values),
      notional: notionals[notionals.length - 1],
      notionalOhlc: ohlc(carry ? previous!.point.notionalOhlc!.close : notionals[0], notionals),
      samples: kept.length,
      coverage,
      complete: coverage.length === MOCK_AGGREGATE.members.length,
      coverageStart: previous === null || previous.key !== key,
      members: closing.legs,
    };
    out.push(point);
    previous = { time, key, point };
  }
  return out;
}
