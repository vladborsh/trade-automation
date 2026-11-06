import { registerCache } from '../../ops/cache-registry';
import { HttpException, Logger } from '@nestjs/common';
import { BINANCE_INVALID_SYMBOL } from '../../venues/binance/rest.base';
import { BinanceHttpError, type BinanceRestKline } from '@trade-automation/binance-client';
import type { WebCandle, WebMarket, WebTimeframe } from '@trade-automation/contracts';
import { BinanceWeightTracker } from '../../venues/binance/binance-weight.tracker';
import {
  CACHE_MAX_PAGES, LruCache, MAX_BARS_PER_REQUEST, PAGE_LIMIT, TAIL_LIMIT, barsIn, closedUntil, isTail, maxDaysFor,
  packCandles, pageKey, pageSpanMs, pagesFor, reachesFormingBar, unpackCandles, type CachedPage,
} from './candle-pages';
import { WEIGHT_CEILING_1M } from './universe-summary.service';
import { timeframeMs } from '../series/range';
import { klinesWeight } from '../../news/reaction-prices';

/**
 * IB-063 — the instrument chart's candles, read from Binance on demand instead of from the local
 * tape. The tape started on 2026-09-28, so every window before it came back empty and the page
 * took that for the start of the coin's history. This is WD-008 step 2's `CandlesService`, built
 * early and for candles only: OI, funding and liquidations still come from the database.
 *
 * perp: `/fapi/v1/klines` (1 500 rows a page). spot: `/api/v3/klines` (1 000 rows a page), the same
 * 12-column row on both. Each is asked for one aligned page at a time
 * (`candle-pages.ts`), and the closed part of every page is remembered: a bar that has closed never
 * changes, so scrolling back over it, or switching timeframe and back, costs the venue nothing.
 * The live edge — the bar still forming — is never cached.
 *
 * IB-065: perp no longer goes through `BinanceAdapter.fetchCandles`. That method is typed by the
 * backtest's `Timeframe` (no 3m, no 1w) and pages by `TIMEFRAME_MS`, which has neither; widening
 * that shared enum reaches signal-server and the backtest app for a chart's sake. One page request
 * is all this service ever makes, so both markets share `fetchKlinePage` below.
 *
 * **Weight**, Binance's documented costs, not measured by us. `/fapi/v1/klines` costs 5 for
 * `limit` 500–1000 and 10 above 1000, so a perp page is 10 against the USD-M 2 400/min budget.
 * Spot's `/api/v3/klines` is 2, against spot's own 6 000/min, and is reported to spot's gauge
 * (`ib_binance_spot_weight_used_1m`), never to the futures one (IB-006 §4.5).
 *
 * | tf | dashboard window | page span | uncached pages per window | perp weight per window |
 * |---|---|---|---|---|
 * | 1m | 1 d | 25 h | 1–2 | 10–20 |
 * | 3m | 3 d | 3.1 d | 1–2 | 10–20 |
 * | 5m | 5 d | 5.2 d | 1–2 | 10–20 |
 * | 15m | 7 d | 15.6 d | 0–2 | 0–20 |
 * | 1h | 30 d | 62.5 d | 0–2 | 0–20 |
 * | 4h | 90 d | 250 d | 0–2 | 0–20 |
 * | 1d | 90 d | 4.1 y | 0–1 | 0–10 |
 * | 1w | 728 d (104 weeks) | 28.8 y | 0–1 | 0–10 |
 *
 * Every window also reads 1d for the day/week levels: one page that covers four years, so it is
 * bought once at page open (the live edge) and is a cache hit on every scroll after that.
 *
 * Per minute: opening the page is 20–30. Scrolling back, a window costs on average
 * window ÷ page span pages: about 10 weight at 1m, 3m and 5m (each window is ~0.96 of a page) and
 * under 5 at 15m/1h/4h. 1w is one page for the whole of a coin's history, so scrolling back on 1w
 * costs nothing after the first read. The client reads one window at a time; at a window every 2 s
 * (faster than a reader scrolls) that is ≤ 300/min at 1m/3m/5m, 12.5 % of 2 400, and ≤ 150/min on
 * the other frames. Above `WEIGHT_CEILING_1M` (1 800) a read
 * that needs the venue answers 503 rather than adding to it; a cached read still answers.
 *
 * **IB-066, the live tail.** An open instrument page asks every 5 s for the bars from its last
 * candle's open to now: one or two bars. Through the page path that is a whole 1 500-row page each
 * time, because the forming bar is never cached: 10 weight, 120/min per tab. A window of fewer than
 * `TAIL_LIMIT` bars that reaches the forming bar is therefore asked for as itself, `limit=99`, which
 * Binance documents at weight 1 for `limit` in [1, 100) (USD-M "Kline/Candlestick Data" weight
 * table, as carried in Binance's own `binance-connector-js`
 * `derivatives-trading-usds-futures/src/rest-api/modules/market-data-api.ts`, read 2026-10-29).
 * 12 polls a minute × 1 = **~12 weight/min per open tab**; the other panes are read from the
 * bot's database and cost the venue nothing. Against 2 400/min with ~1 % (~25) already used and
 * `WEIGHT_CEILING_1M` at 1 800, about 140 tabs fit before reads are refused. A tail is never
 * cached: it is mostly the forming bar, and its closed bars arrive through the page path anyway.
 */

/** A hung page must not hold a chart request open: the venue answers in well under a second. */
export const PAGE_TIMEOUT_MS = 10_000;

/** `/fapi/v1/klines` at `limit` 1500 (Binance docs: 10 above 1000). */
export const PERP_PAGE_WEIGHT = 10;
/** `/fapi/v1/klines` at `limit` < 100 (Binance docs: 1 for [1, 100)) — the live tail (IB-066). */
export const PERP_TAIL_WEIGHT = 1;
/** `/api/v3/klines` (Binance docs: 2 at any `limit`). */
export const SPOT_PAGE_WEIGHT = 2;

/** Binance's code for an unknown symbol, on both fapi and api (one definition: venues/binance/rest.base.ts). */
const INVALID_SYMBOL = BINANCE_INVALID_SYMBOL;

export interface CandlesServiceOptions {
  futuresBaseUrl: string;
  spotBaseUrl: string;
  weight: BinanceWeightTracker;
  /** Spot's `x-mbx-used-weight-1m` header, for spot's own gauge. */
  onSpotWeight?: (usedWeight1m: number) => void;
  fetchImpl?: typeof fetch;
  now?: () => number;
  maxPages?: number;
}

export class CandlesService {
  private readonly logger = new Logger(CandlesService.name);
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cache: LruCache<CachedPage>;
  /** One request per page however many charts ask for it at once (the window and its 1d levels). */
  private readonly inFlight = new Map<string, Promise<WebCandle[]>>();

  constructor(private readonly options: CandlesServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
    this.cache = new LruCache(options.maxPages ?? CACHE_MAX_PAGES);
    registerCache('candles', this.cache);
  }

  /** The candles in `[fromMs, toMs)`, oldest first. Throws the wire error the route should answer. */
  async candles(market: WebMarket, symbol: string, tf: WebTimeframe, fromMs: number, toMs: number): Promise<WebCandle[]> {
    if (barsIn(tf, fromMs, toMs) > MAX_BARS_PER_REQUEST) {
      throw new HttpException({
        code: 'RANGE_TOO_WIDE',
        message: `a ${tf} candle range may span at most ${MAX_BARS_PER_REQUEST} bars`,
        maxDays: maxDaysFor(tf),
      }, 400);
    }
    if (isTail(tf, fromMs, toMs, this.now())) {
      return this.tail(market, symbol, tf, fromMs, toMs);
    }
    const out: WebCandle[] = [];
    for (const pageStart of pagesFor(market, tf, fromMs, toMs)) {
      const rows = await this.page(market, symbol, tf, pageStart, toMs);
      for (const row of rows) {
        const ms = row.time * 1000;
        if (ms >= fromMs && ms < toMs) out.push(row);
      }
    }
    return out;
  }

  /**
   * IB-115 (design V24): `limit` CLOSED perp klines from `fromMs`, as ONE request at exactly that limit, at
   * the weight Binance documents for it (`klinesWeight`: 48 → 1, 288 → 2, 864 → 5) — not the 1 500-row page
   * (weight 10) the chart's path uses. Not cached: each window is read once, after it has closed. An
   * unknown symbol is an empty answer; anything else throws (the caller retries later).
   */
  async closedKlines(symbol: string, tf: WebTimeframe, fromMs: number, limit: number): Promise<WebCandle[]> {
    this.refuseAboveCeiling('perp');
    const toMs = fromMs + limit * timeframeMs(tf);
    try {
      const rows = await this.fetchKlinePage('perp', symbol, tf, fromMs, toMs - 1, limit, klinesWeight(limit));
      return rows.map(toWebCandle).filter((c) => c.time * 1000 >= fromMs && c.time * 1000 < toMs && (c.time * 1000 + timeframeMs(tf)) <= this.now());
    } catch (error) {
      if (error instanceof BinanceHttpError && error.status === 400 && error.venueCode === INVALID_SYMBOL) return [];
      throw error;
    }
  }

  /**
   * IB-147: `total` CLOSED bars from `fromMs` at the least documented weight — `closedKlines` in the chunks
   * `cheapestChunks` picks (720 → 2 × 360 at weight 2 each = 4, against 5 for one request of 720), oldest first.
   */
  async closedKlinesCheapest(symbol: string, tf: WebTimeframe, fromMs: number, total: number): Promise<WebCandle[]> {
    const out: WebCandle[] = [];
    let from = fromMs;
    for (const n of cheapestChunks(total)) {
      out.push(...(await this.closedKlines(symbol, tf, from, n)));
      from += n * timeframeMs(tf);
    }
    return out;
  }

  /** IB-066: true when `[fromMs, toMs)` holds the bar still forming, by this service's clock. */
  reachesFormingBar(tf: WebTimeframe, fromMs: number, toMs: number): boolean {
    return reachesFormingBar(tf, fromMs, toMs, this.now());
  }

  /** IB-066: a few bars at weight 1, straight from the venue and not cached (see the class comment). */
  private async tail(market: WebMarket, symbol: string, tf: WebTimeframe, fromMs: number, toMs: number): Promise<WebCandle[]> {
    this.refuseAboveCeiling(market);
    try {
      const rows = await this.fetchKlinePage(market, symbol, tf, fromMs, toMs - 1, TAIL_LIMIT, PERP_TAIL_WEIGHT);
      return rows.map(toWebCandle).filter((c) => c.time * 1000 >= fromMs && c.time * 1000 < toMs);
    } catch (error) {
      const wire = this.toWireError(error, market, symbol, tf);
      if (wire === null) return [];
      throw wire;
    }
  }

  /** One aligned page, from cache when the cached part reaches `toMs`. */
  private async page(
    market: WebMarket, symbol: string, tf: WebTimeframe, pageStart: number, toMs: number,
  ): Promise<readonly WebCandle[]> {
    const key = pageKey({ market, symbol, tf, pageStart });
    const pageEnd = pageStart + pageSpanMs(market, tf);
    const cached = this.cache.get(key);
    // the part of the window on THIS page: a window running on into the next page is still
    // fully answered here once this page is final
    if (cached && Math.min(toMs, pageEnd) <= cached.closedUntilMs) return unpackCandles(cached.packed);

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = this.fetchPage(market, symbol, tf, pageStart).then((rows) => {
      const until = closedUntil(tf, pageStart, pageEnd, this.now());
      const closed = rows.filter((r) => r.time * 1000 < until);
      // a page that has not started closing yet is not worth a slot
      if (until > pageStart) this.cache.set(key, { packed: packCandles(closed), closedUntilMs: until });
      return rows;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  private refuseAboveCeiling(market: WebMarket): void {
    if (market === 'perp' && this.options.weight.used1m(this.now()) > WEIGHT_CEILING_1M) {
      throw new HttpException(
        { code: 'VENUE_UNAVAILABLE', message: `Binance weight above ${WEIGHT_CEILING_1M}/min; not adding to it` },
        503,
      );
    }
  }

  private async fetchPage(market: WebMarket, symbol: string, tf: WebTimeframe, pageStart: number): Promise<WebCandle[]> {
    this.refuseAboveCeiling(market);
    const pageEnd = pageStart + pageSpanMs(market, tf) - 1; // endTime is inclusive on Binance
    try {
      const rows = await this.fetchKlinePage(market, symbol, tf, pageStart, pageEnd, PAGE_LIMIT[market], PERP_PAGE_WEIGHT);
      return rows.map(toWebCandle);
    } catch (error) {
      const wire = this.toWireError(error, market, symbol, tf);
      if (wire === null) return []; // cached like any page: an unknown symbol stays unknown
      throw wire;
    }
  }

  /**
   * One request for klines, at `limit` rows and the perp weight that limit is documented at. `interval` is the timeframe id verbatim (`WebTimeframeSchema` is spelled as
   * Binance spells it). Weight goes where each market's budget is kept: perp into the shared
   * tracker (documented cost + the venue's header), spot to its own gauge.
   */
  private async fetchKlinePage(
    market: WebMarket, symbol: string, tf: WebTimeframe, from: number, to: number, limit: number, perpWeight: number,
  ): Promise<BinanceRestKline[]> {
    const perp = market === 'perp';
    const url = perp
      ? new URL('/fapi/v1/klines', this.options.futuresBaseUrl)
      : new URL('/api/v3/klines', this.options.spotBaseUrl);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', tf);
    url.searchParams.set('startTime', String(from));
    url.searchParams.set('endTime', String(to));
    url.searchParams.set('limit', String(limit));
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
    if (perp) {
      this.options.weight.recordCall(perpWeight, this.now());
      this.options.weight.recordFromHeaders(res.headers, this.now());
    } else {
      const used = Number(res.headers.get('x-mbx-used-weight-1m'));
      if (Number.isFinite(used) && used > 0) this.options.onSpotWeight?.(used);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
      throw new BinanceHttpError(res.status, res.statusText, typeof body?.code === 'number' ? body.code : null);
    }
    return (await res.json()) as BinanceRestKline[];
  }

  /**
   * What a failed page means to the caller. `null` is an unknown symbol: an empty chart, as the
   * database answered it. A ban (429/418) or our own ceiling is 503; anything else — a timeout, a 5xx, a
   * dropped connection — is the venue failing us, 502, never a 500 that reads as our bug.
   */
  private toWireError(error: unknown, market: WebMarket, symbol: string, tf: WebTimeframe): HttpException | null {
    if (error instanceof HttpException) return error;
    const what = `${market} ${symbol} ${tf}`;
    if (error instanceof BinanceHttpError) {
      if (error.status === 400 && error.venueCode === INVALID_SYMBOL) return null;
      if (error.status === 429 || error.status === 418) {
        this.logger.warn(`Binance answered ${error.status} to klines for ${what}: rate limited`);
        return new HttpException({ code: 'VENUE_UNAVAILABLE', message: `Binance rate limit (${error.status})` }, 503);
      }
    }
    return new HttpException(
      { code: 'VENUE_UNAVAILABLE', message: `Binance klines for ${what} failed: ${(error as Error).message}` },
      502,
    );
  }
}

/** A kline row onto the wire: columns 0–5 and 9 (taker-buy base volume), as `mapRestKline` reads them. */
function toWebCandle(row: BinanceRestKline): WebCandle {
  const [openTime, open, high, low, close, volume, , , , takerBuyVolume] = row;
  return {
    time: Math.floor(openTime / 1000),
    open: Number(open), high: Number(high), low: Number(low), close: Number(close),
    volume: Number(volume),
    takerBuyVolume: takerBuyVolume === undefined ? null : Number(takerBuyVolume),
  };
}

/**
 * IB-147: how to read `total` bars in the fewest documented weight (`klinesWeight`: < 100 → 1, < 500 → 2, ≤ 1000 → 5):
 * equal chunks, each ≤ 1000, choosing the chunk count with the least summed weight (fewer requests on a tie).
 * 720 → [360, 360] (weight 4, against 5 for one request); 288 → [288] (2); 1000 → [1000] (5; three requests would be 6).
 */
export function cheapestChunks(total: number): number[] {
  if (total <= 0) return [];
  let best: number[] = [];
  let bestWeight = Number.POSITIVE_INFINITY;
  for (let k = Math.ceil(total / 1000); k <= Math.ceil(total / 99) + 1 && k <= total; k++) {
    const size = Math.floor(total / k);
    const chunks = Array.from({ length: k }, (_, i) => size + (i < total - size * k ? 1 : 0));
    const w = chunks.reduce((sum, n) => sum + klinesWeight(n), 0);
    if (w < bestWeight) { best = chunks; bestWeight = w; }
  }
  return best;
}
