/**
 * IB-036 — the two keyless market-context sources, confirmed live on 2026-09-28
 * (architecture/insight-bot-web-dashboard.md §10, which records the probe results). Payloads are
 * kept verbatim in `test/fixtures/context/`.
 *
 * **Neither source needs a key and none was requested.** The endpoints that do need one are not
 * used: `/global/market_cap_chart` (401 on the free tier) and `market_chart?days=max`
 * (401, error 10012).
 *
 * Request rates, against each source's published limit:
 *
 * | Source | Our rate | Their limit |
 * |---|---|---|
 * | `api.alternative.me/fng/` | **1/day** (plus one backfill call on first run) | none published; a daily index |
 * | CoinGecko `/api/v3/global` | **144/day = 0.1/min** | ~5–15/min keyless |
 * | CoinGecko `/coins/{id}/market_chart` | **20/day** (plus 20 on first run) | same pool |
 *
 * Total ≈ **165 CoinGecko requests/day ≈ 0.11/min**, roughly 1 % of the keyless allowance. The
 * client still backs off on 429 (60 s, at most 3 retries) because the limit is shared per IP and
 * another process on the box may be spending it too.
 */

/** `GET https://api.alternative.me/fng/?limit=N` */
export interface FngPayload {
  name?: string;
  data: FngRow[];
  metadata?: { error: string | null };
}

/**
 * Observed: `{"value":"74","value_classification":"Greed","timestamp":"1790553600",
 * "time_until_update":"18079"}`. Every field is a string; `timestamp` is **seconds**, and only
 * the newest row carries `time_until_update`.
 */
export interface FngRow {
  value: string;
  value_classification: string;
  timestamp: string;
  time_until_update?: string;
}

/** `GET https://api.coingecko.com/api/v3/global` */
export interface GlobalPayload {
  data: {
    total_market_cap: Record<string, number>;
    market_cap_percentage: Record<string, number>;
    updated_at?: number;
  };
}

/**
 * `GET /api/v3/coins/{id}/market_chart?vs_currency=usd&days=N&interval=daily`
 *
 * Three parallel arrays of `[msTimestamp, value]`. They are aligned in practice but the mapper
 * does not assume it: it joins on the timestamp, so a source that ever returns a price without a
 * market cap yields `cap_usd = null` rather than a silently mismatched pairing.
 */
export interface MarketChartPayload {
  prices: Array<[number, number]>;
  market_caps: Array<[number, number]>;
  total_volumes?: Array<[number, number]>;
}
