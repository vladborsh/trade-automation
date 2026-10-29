import { HttpException, Logger } from '@nestjs/common';
import {
  BinanceAdapter, BinanceHttpError, mapRestKline, type BinanceRestKline,
} from '@trade-automation/binance-client';
import type { Candle, WebCandle, WebMarket, WebTimeframe } from '@trade-automation/contracts';
import { BinanceWeightTracker } from '../../collectors/binance-perp/binance-weight.tracker';
import {
  CACHE_MAX_PAGES, LruCache, MAX_BARS_PER_REQUEST, PAGE_LIMIT, barsIn, closedUntil, maxDaysFor, pageKey,
  pageSpanMs, pagesFor, type CachedPage,
} from './candle-pages';
import { WEIGHT_CEILING_1M } from './universe-summary.service';

/**
 * IB-063 — the instrument chart's candles, read from Binance on demand instead of from the local
 * tape. The tape started on 2026-09-28, so every window before it came back empty and the page
 * took that for the start of the coin's history. This is WD-008 step 2's `CandlesService`, built
 * early and for candles only: OI, funding and liquidations still come from the database.
 *
 * perp: `BinanceAdapter.fetchCandles` (`/fapi/v1/klines`, 1 500 rows a page). spot:
 * `/api/v3/klines` (1 000 rows a page). Both are asked for one aligned page at a time
 * (`candle-pages.ts`), and the closed part of every page is remembered: a bar that has closed never
 * changes, so scrolling back over it, or switching timeframe and back, costs the venue nothing.
 * The live edge — the bar still forming — is never cached.
 *
 * **Weight**, Binance's documented costs, not measured by us. `/fapi/v1/klines` costs 5 for
 * `limit` 500–1000 and 10 above 1000, so a perp page is 10 against the USD-M 2 400/min budget.
 * Spot's `/api/v3/klines` is 2, against spot's own 6 000/min, and is reported to spot's gauge
 * (`ib_binance_spot_weight_used_1m`), never to the futures one (IB-006 §4.5).
 *
 * | tf | dashboard window | page span | uncached pages per window | perp weight per window |
 * |---|---|---|---|---|
 * | 1m | 1 d | 25 h | 1–2 | 10–20 |
 * | 15m | 7 d | 15.6 d | 0–2 | 0–20 |
 * | 1h | 30 d | 62.5 d | 0–2 | 0–20 |
 * | 4h | 90 d | 250 d | 0–2 | 0–20 |
 * | 1d | 90 d | 4.1 y | 0–1 | 0–10 |
 *
 * Every window also reads 1d for the day/week levels: one page that covers four years, so it is
 * bought once at page open (the live edge) and is a cache hit on every scroll after that.
 *
 * Per minute: opening the page is 20–30. Scrolling back, a window costs on average
 * window ÷ page span pages: about 10 weight at 1m and under 5 at 15m/1h/4h. The client reads one
 * window at a time; at a window every 2 s (faster than a reader scrolls) that is ≤ 300/min at 1m,
 * 12.5 % of 2 400, and ≤ 150/min on the other frames. Above `WEIGHT_CEILING_1M` (1 800) a read
 * that needs the venue answers 503 rather than adding to it; a cached read still answers.
 */

/** A hung page must not hold a chart request open: the venue answers in well under a second. */
export const PAGE_TIMEOUT_MS = 10_000;

/** `/fapi/v1/klines` at `limit` 1500 (Binance docs: 10 above 1000). */
export const PERP_PAGE_WEIGHT = 10;
/** `/api/v3/klines` (Binance docs: 2 at any `limit`). */
export const SPOT_PAGE_WEIGHT = 2;

/** Binance's code for an unknown symbol, on both fapi and api. */
const INVALID_SYMBOL = -1121;

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
  private readonly adapter: BinanceAdapter;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cache: LruCache<CachedPage>;
  /** One request per page however many charts ask for it at once (the window and its 1d levels). */
  private readonly inFlight = new Map<string, Promise<WebCandle[]>>();

  constructor(private readonly options: CandlesServiceOptions) {
    // the adapter's socket half is never used here: no stream is opened, so no WS URL is needed
    this.adapter = new BinanceAdapter(options.futuresBaseUrl, '', {
      log: (m) => this.logger.log(m),
      warn: (m) => this.logger.warn(m),
    });
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
    this.cache = new LruCache(options.maxPages ?? CACHE_MAX_PAGES);
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

  /** One aligned page, from cache when the cached part reaches `toMs`. */
  private async page(
    market: WebMarket, symbol: string, tf: WebTimeframe, pageStart: number, toMs: number,
  ): Promise<readonly WebCandle[]> {
    const key = pageKey({ market, symbol, tf, pageStart });
    const pageEnd = pageStart + pageSpanMs(market, tf);
    const cached = this.cache.get(key);
    // the part of the window on THIS page: a window running on into the next page is still
    // fully answered here once this page is final
    if (cached && Math.min(toMs, pageEnd) <= cached.closedUntilMs) return cached.rows;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = this.fetchPage(market, symbol, tf, pageStart).then((rows) => {
      const until = closedUntil(tf, pageStart, pageEnd, this.now());
      const closed = rows.filter((r) => r.time * 1000 < until);
      // a page that has not started closing yet is not worth a slot
      if (until > pageStart) this.cache.set(key, { rows: closed, closedUntilMs: until });
      return rows;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  private async fetchPage(market: WebMarket, symbol: string, tf: WebTimeframe, pageStart: number): Promise<WebCandle[]> {
    if (market === 'perp' && this.options.weight.used1m(this.now()) > WEIGHT_CEILING_1M) {
      throw new HttpException(
        { code: 'VENUE_UNAVAILABLE', message: `Binance weight above ${WEIGHT_CEILING_1M}/min; not adding to it` },
        503,
      );
    }
    const pageEnd = pageStart + pageSpanMs(market, tf) - 1; // endTime is inclusive on Binance
    try {
      const candles = market === 'perp'
        ? await this.adapter.fetchCandles({ id: `binance:${symbol}`, symbol }, tf, pageStart, pageEnd, {
          fetchImpl: this.fetchImpl,
          signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
          onResponse: (res) => {
            this.options.weight.recordCall(PERP_PAGE_WEIGHT, this.now());
            this.options.weight.recordFromHeaders(res.headers, this.now());
          },
        })
        : await this.fetchSpotPage(symbol, tf, pageStart, pageEnd);
      return candles.map(toWebCandle);
    } catch (error) {
      const wire = this.toWireError(error, market, symbol, tf);
      if (wire === null) return []; // cached like any page: an unknown symbol stays unknown
      throw wire;
    }
  }

  /** One spot page: `/api/v3/klines` returns the same array-of-arrays row as fapi. */
  private async fetchSpotPage(symbol: string, tf: WebTimeframe, from: number, to: number): Promise<Candle[]> {
    const url = new URL('/api/v3/klines', this.options.spotBaseUrl);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', tf);
    url.searchParams.set('startTime', String(from));
    url.searchParams.set('endTime', String(to));
    url.searchParams.set('limit', String(PAGE_LIMIT.spot));
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
    const used = Number(res.headers.get('x-mbx-used-weight-1m'));
    if (Number.isFinite(used) && used > 0) this.options.onSpotWeight?.(used);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
      throw new BinanceHttpError(res.status, res.statusText, typeof body?.code === 'number' ? body.code : null);
    }
    const rows = (await res.json()) as BinanceRestKline[];
    return rows.map((row) => mapRestKline(`binance:${symbol}`, row, tf));
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

function toWebCandle(c: Candle): WebCandle {
  return {
    time: Math.floor(c.openTime / 1000),
    open: c.open, high: c.high, low: c.low, close: c.close,
    volume: c.volume,
    takerBuyVolume: c.takerBuyVolume ?? null,
  };
}
