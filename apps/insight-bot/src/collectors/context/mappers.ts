import { FngPayload, GlobalPayload, MarketChartPayload } from './payloads';

/** One `fear_greed` row. */
export interface FearGreedRow {
  day: string; // YYYY-MM-DD, UTC
  value: number;
  classification: string;
  fetchedAt: Date;
}

/** One `market_cap_global` row. */
export interface MarketCapGlobalRow {
  ts: Date;
  totalUsd: number;
  btcPct: number | null;
  ethPct: number | null;
  dominance: Record<string, number>;
  fetchedAt: Date;
}

/** One `market_cap_coin` row. */
export interface MarketCapCoinRow {
  day: string; // YYYY-MM-DD, UTC
  coin: string;
  capUsd: number | null;
  priceUsd: number | null;
  fetchedAt: Date;
}

/** The UTC day a ms timestamp falls in — every date in this app is UTC (§3.1). */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function num(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`market-context payload: '${field}' is not a number (${String(value)})`);
  return parsed;
}

/**
 * alternative.me publishes one value per UTC day; `timestamp` is in **seconds**, not ms.
 * `limit=0` returns the whole history since 2018-02-01 in a single call, which is why this is the
 * one context series that can be backfilled.
 */
export function fearGreedRows(payload: FngPayload, fetchedAt = new Date()): FearGreedRow[] {
  if (payload.metadata?.error) throw new Error(`alternative.me returned an error: ${payload.metadata.error}`);
  return payload.data.map((row) => {
    const seconds = num(row.timestamp, 'timestamp');
    const value = num(row.value, 'value');
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new Error(`fear & greed value out of range: ${row.value}`);
    }
    return {
      day: utcDay(seconds * 1000),
      value,
      classification: row.value_classification,
      fetchedAt,
    };
  });
}

/**
 * `/global` → one `market_cap_global` row, stamped with the venue's own `updated_at` when it
 * sends one so two polls that straddle the same refresh collapse onto one row (the primary key
 * is `ts`, so this is what makes the 10-minute poll idempotent rather than duplicating).
 *
 * `btc_pct`/`eth_pct` are lifted out for the common query but stay **null when absent** — a
 * missing dominance figure is not 0 % (§2.3's rule). The whole map is kept in `dominance`
 * because this series cannot be re-collected later.
 */
export function marketCapGlobalRow(payload: GlobalPayload, fetchedAt = new Date()): MarketCapGlobalRow {
  const data = payload.data;
  const dominance = data.market_cap_percentage ?? {};
  const totalUsd = data.total_market_cap?.usd;
  if (totalUsd === undefined) throw new Error("/global payload has no total_market_cap.usd");
  return {
    ts: data.updated_at !== undefined ? new Date(num(data.updated_at, 'updated_at') * 1000) : fetchedAt,
    totalUsd: num(totalUsd, 'total_market_cap.usd'),
    btcPct: typeof dominance.btc === 'number' ? dominance.btc : null,
    ethPct: typeof dominance.eth === 'number' ? dominance.eth : null,
    dominance,
    fetchedAt,
  };
}

/**
 * `market_chart` → one `market_cap_coin` row per day, joined on the timestamp rather than by
 * position: the two arrays are aligned in every payload observed, but a price without a matching
 * cap must give `cap_usd = null`, not the neighbouring day's cap.
 *
 * The final element is the **current, partial day** — CoinGecko's `days=N` window ends at now,
 * not at the last midnight. It is kept: `market_cap_coin`'s key is `(day, coin)` and the upsert
 * overwrites, so tomorrow's run replaces today's partial value with the settled one.
 */
export function marketCapCoinRows(
  payload: MarketChartPayload,
  coin: string,
  fetchedAt = new Date(),
): MarketCapCoinRow[] {
  const capByMs = new Map<number, number>();
  for (const [ms, cap] of payload.market_caps ?? []) capByMs.set(ms, cap);

  const byDay = new Map<string, MarketCapCoinRow>();
  for (const [ms, price] of payload.prices ?? []) {
    const day = utcDay(num(ms, 'prices[].0'));
    const cap = capByMs.get(ms);
    byDay.set(day, {
      day,
      coin,
      capUsd: typeof cap === 'number' && Number.isFinite(cap) ? cap : null,
      priceUsd: Number.isFinite(price) ? price : null,
      fetchedAt,
    });
  }
  // A cap with no matching price still deserves a row — the cap is what the dashboard charts.
  for (const [ms, cap] of payload.market_caps ?? []) {
    const day = utcDay(num(ms, 'market_caps[].0'));
    if (!byDay.has(day)) {
      byDay.set(day, { day, coin, capUsd: Number.isFinite(cap) ? cap : null, priceUsd: null, fetchedAt });
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
