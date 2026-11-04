import { Logger } from '@nestjs/common';
import { WEB_VENUE_NAMES, type WebFlowsResponse, type WebFlowsUnavailable, type WebMarketPeriod } from '@trade-automation/contracts';
import {
  COINBASE_PAGE_BARS, DVOL_DAILY_DAYS, DVOL_HOURLY_DAYS, FLOWS_CACHE_MS, FLOWS_DVOL_CACHE_MS, FLOWS_MINUTE_CACHE_MS,
  FLOWS_PREMIUM_HISTORY_CACHE_MS, FLOWS_PUTCALL_CACHE_MS, FLOWS_STABLECOINS_CACHE_MS, PREMIUM_HISTORY_HOURS,
  PREMIUM_WINDOW_MIN, STABLECOIN_SAMPLE_DAYS,
} from '../../insights/thresholds';
import { globalFetch, type FetchLike } from '../../venues/fetch-like';
import {
  parseCoinbaseCandles, parseDvol, parsePutCall, parseStablecoinTotals, premiumSeries, type PutCallDay, type TimedValue,
} from '../../venues/flows/parse';
import type { TtlCache } from '../../venues/ttl-cache';
import type { CandlesService } from './candles.service';
import { dvolTile, premiumTile, putCallTile, stablecoinTile } from './flows.assemble';

/**
 * IB-091 — «Деривативы и потоки»: `GET /api/web/market/flows?period=`. Cache only (D7): every
 * source keeps its own history, so nothing is stored. Each read is cached box-wide, so N members
 * polling every 5 minutes cost the sources what one does.
 *
 * | read | cache | calls/min |
 * |---|---|---|
 * | Deribit DVOL BTC, hourly 30 d + daily 400 d | 15 min | 0.13 |
 * | OKX rubik put/call by OI, daily | 60 min | 0.017 |
 * | DefiLlama stablecoin chart (1.3 MB, parsed and dropped: ~400 numbers kept) | 60 min | 0.017 |
 * | Coinbase BTC-USD + USDT-USD 1m (D18) | 60 s | 2 |
 * | Coinbase BTC-USD + USDT-USD 1h, 2 pages each (25 days, D3) | 60 min | 0.067 |
 * | Binance SPOT BTCUSDT: the 1m tail (weight 2) + 1h pages (cached by CandlesService) | 60 s / page cache | ≈ 1 (≈ 2 spot weight) |
 * Binance fapi weight is unchanged; the spot reads land on the spot gauge.
 *
 * **D18: the premium is against the dollar with USDT divided out, and has no fallback.** If any of
 * the three series fails, the premium fails and the tile says `source_unavailable` — never the raw
 * CB − BN difference, which is mostly USDT's own price.
 */
export const FLOWS_BASE_URLS = {
  deribit: 'https://www.deribit.com/api/v2',
  okx: 'https://www.okx.com',
  defillama: 'https://stablecoins.llama.fi',
  coinbase: 'https://api.exchange.coinbase.com',
} as const;

const SOURCES = {
  dvol: { name: WEB_VENUE_NAMES.deribit, url: 'https://www.deribit.com' },
  putCall: { name: WEB_VENUE_NAMES.okx, url: 'https://www.okx.com' },
  stablecoins: { name: WEB_VENUE_NAMES.defillama, url: 'https://defillama.com/stablecoins' },
  coinbasePremium: { name: WEB_VENUE_NAMES.coinbase, url: 'https://exchange.coinbase.com' },
} as const;

const TIMEOUT_MS = 10_000;
const H = 3_600_000;
const D = 86_400_000;

export interface FlowsServiceOptions {
  cache: TtlCache;
  candles: CandlesService;
  fetchImpl?: FetchLike;
  baseUrls?: Partial<typeof FLOWS_BASE_URLS>;
  now?: () => number;
}

export class FlowsService {
  private readonly logger = new Logger(FlowsService.name);
  private readonly fetchImpl: FetchLike;
  private readonly urls: typeof FLOWS_BASE_URLS;
  private readonly now: () => number;

  constructor(private readonly options: FlowsServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? globalFetch;
    this.urls = { ...FLOWS_BASE_URLS, ...options.baseUrls };
    this.now = options.now ?? Date.now;
  }

  flows(period: WebMarketPeriod): Promise<WebFlowsResponse> {
    return this.options.cache.getOrLoad(`flows:${period}`, FLOWS_CACHE_MS, () => this.compute(period));
  }

  private async compute(period: WebMarketPeriod): Promise<WebFlowsResponse> {
    const nowMs = this.now();
    const settle = <T>(what: string, p: Promise<T>): Promise<T | null> => p.catch((error: unknown) => {
      this.logger.warn(`flows ${what}: ${(error as Error).message}`);
      return null;
    });
    const [dvolH, dvolD, putCall, stable, minutes, hourly] = await Promise.all([
      settle('DVOL hourly', this.dvol(3_600, DVOL_HOURLY_DAYS)),
      settle('DVOL daily', this.dvol('1D', DVOL_DAILY_DAYS)),
      settle('put/call', this.putCall()),
      settle('stablecoins', this.stablecoins()),
      settle('premium minutes', this.premiumMinutes()),
      settle('premium history', this.premiumHourly()),
    ]);
    const reason = (ok: boolean): WebFlowsUnavailable | null => (ok ? null : 'source_unavailable');

    const dvol = dvolH ? dvolTile(dvolH, dvolD ?? [], period) : { value: null, change: null, series: [] };
    const pc = putCallTile(putCall ?? []);
    const sc = stablecoinTile(stable ?? [], period);
    const prem = minutes ? premiumTile(minutes, hourly ?? [], Math.floor(nowMs / 1000)) : null;
    return {
      period,
      asOf: Math.floor(nowMs / 1000),
      dvol: { currency: 'BTC', ...dvol, unavailable: reason(dvol.value !== null), source: SOURCES.dvol },
      putCall: { currency: 'BTC', ...pc, unavailable: reason(pc.oiRatio !== null), source: SOURCES.putCall },
      stablecoins: { ...sc, unavailable: reason(sc.supplyUsd !== null), source: SOURCES.stablecoins },
      coinbasePremium: prem
        ? { ...prem, source: SOURCES.coinbasePremium }
        : { premiumPct: null, sameSignMinutes: 0, minutes: 0, series: [], unavailable: 'source_unavailable', source: SOURCES.coinbasePremium },
    };
  }

  private async json(url: string): Promise<unknown> {
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${response.statusText}`);
    return response.json();
  }

  /** Deribit DVOL closes; `resolution` 3600 (hourly) or '1D'. One page: ≤ 1000 points. */
  private dvol(resolution: 3600 | '1D', days: number): Promise<TimedValue[]> {
    return this.options.cache.getOrLoad(`flows:dvol:${resolution}`, FLOWS_DVOL_CACHE_MS, async () => {
      const end = this.now();
      const url = `${this.urls.deribit}/public/get_volatility_index_data?currency=BTC&resolution=${resolution}&start_timestamp=${end - days * D}&end_timestamp=${end}`;
      return parseDvol(await this.json(url));
    });
  }

  private putCall(): Promise<PutCallDay[]> {
    return this.options.cache.getOrLoad('flows:putcall', FLOWS_PUTCALL_CACHE_MS, async () =>
      parsePutCall(await this.json(`${this.urls.okx}/api/v5/rubik/stat/option/open-interest-volume-ratio?ccy=BTC&period=1D`)));
  }

  /** The 1.3 MB chart is parsed here and dropped: only the last year (+ a margin) of daily totals is kept. */
  private stablecoins(): Promise<TimedValue[]> {
    return this.options.cache.getOrLoad('flows:stablecoins', FLOWS_STABLECOINS_CACHE_MS, async () => {
      const all = parseStablecoinTotals(await this.json(`${this.urls.defillama}/stablecoincharts/all`));
      return all.slice(-(STABLECOIN_SAMPLE_DAYS + 35));
    });
  }

  private coinbase(product: 'BTC-USD' | 'USDT-USD', granularity: 60 | 3_600, startMs?: number, endMs?: number): Promise<TimedValue[]> {
    const range = startMs === undefined || endMs === undefined ? '' : `&start=${new Date(startMs).toISOString()}&end=${new Date(endMs).toISOString()}`;
    return this.json(`${this.urls.coinbase}/products/${product}/candles?granularity=${granularity}${range}`).then(parseCoinbaseCandles);
  }

  /** Binance BTCUSDT spot closes (CandlesService: the tail uncached, closed pages cached), keyed by bar open. */
  private async binanceSpot(tf: '1m' | '1h', fromMs: number, toMs: number): Promise<TimedValue[]> {
    const rows = await this.options.candles.candles('spot', 'BTCUSDT', tf, fromMs, toMs);
    return rows.map((c) => ({ timeSec: c.time, value: c.close }));
  }

  /** D18 per minute, the last window + a margin; any of the three failing fails the premium (no raw fallback). */
  private premiumMinutes(): Promise<TimedValue[]> {
    return this.options.cache.getOrLoad('flows:premium:1m', FLOWS_MINUTE_CACHE_MS, async () => {
      const now = this.now();
      const [cb, usdt, bn] = await Promise.all([
        this.coinbase('BTC-USD', 60),
        this.coinbase('USDT-USD', 60),
        this.binanceSpot('1m', now - (PREMIUM_WINDOW_MIN + 1) * 60_000, now),
      ]);
      return premiumSeries(cb, usdt, bn);
    });
  }

  /** D18 per hour over PREMIUM_HISTORY_HOURS: R10's reference. Coinbase pages of 300 bars, oldest first. */
  private premiumHourly(): Promise<TimedValue[]> {
    return this.options.cache.getOrLoad('flows:premium:1h', FLOWS_PREMIUM_HISTORY_CACHE_MS, async () => {
      const end = Math.floor(this.now() / H) * H;
      const start = end - PREMIUM_HISTORY_HOURS * H;
      const pages: Array<[number, number]> = [];
      for (let t = start; t < end; t += COINBASE_PAGE_BARS * H) pages.push([t, Math.min(end, t + COINBASE_PAGE_BARS * H)]);
      const both = (product: 'BTC-USD' | 'USDT-USD') => Promise.all(pages.map(([a, b]) => this.coinbase(product, 3_600, a, b)))
        // adjacent pages can both return the boundary hour: one point per hour, or the sample counts it twice
        .then((p) => [...new Map(p.flat().map((x) => [x.timeSec, x])).values()].sort((x, y) => x.timeSec - y.timeSec));
      const [cb, usdt, bn] = await Promise.all([both('BTC-USD'), both('USDT-USD'), this.binanceSpot('1h', start, end)]);
      return premiumSeries(cb, usdt, bn);
    });
  }
}
