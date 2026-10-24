import type { WebUniverseSummaryResponse } from '@trade-automation/contracts';
import type { FetchLike } from '../../collectors/binance-common/rest';
import { BinanceWeightTracker } from '../../collectors/binance-perp/binance-weight.tracker';
import { FuturesDataClient } from '../../collectors/binance-perp/futures-data.client';
import { assembleSummary, type SummarySymbol } from './universe-summary';
import {
  OiHistRowSchema, PremiumIndexSummaryRowSchema, Ticker24hRowSchema,
  type OiHistRow, type PremiumIndexSummaryRow, type Ticker24hRow,
} from './summary.payloads';

/**
 * The instrument page's symbol dropdown, read LIVE from Binance USD-M. Nothing is stored: this is
 * the on-demand direction of `tasks/wind-down.jsonl` (WD-008/WD-009), built ahead of that layer.
 * When WD-008 lands its `TtlCache` and `VenuesModule`, this service should move onto them.
 *
 * **Weight per refresh**, Binance's documented costs, not measured by us:
 *
 * | call | weight | count |
 * |---|---|---|
 * | `GET /fapi/v1/ticker/24hr` (all symbols) | 40 | 1 |
 * | `GET /fapi/v1/premiumIndex` (all symbols) | 10 | 1 |
 * | `GET /futures/data/openInterestHist?period=1h&limit=25` | 1 | one per symbol (20) |
 *
 * So about 50 `fapi` weight plus 20 `/futures/data` calls per refresh. The answer is cached for
 * `CACHE_TTL_MS`, so however many tabs are open the venue sees at most one refresh a minute:
 * about 2 % of the 2,400/min ceiling, plus 20 calls against the separate `/futures/data` limit.
 */
export const CACHE_TTL_MS = 60_000;
/** WD-008's ceiling: above this much of the 2,400/min budget, live reads answer 503. */
export const WEIGHT_CEILING_1M = 1_800;
/** How many open-interest calls are in flight at once. */
const OI_CONCURRENCY = 5;

const TICKER_WEIGHT = 40;
const PREMIUM_WEIGHT = 10;

export class VenueUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VenueUnavailableError';
  }
}

export interface UniverseSummaryOptions {
  futuresBaseUrl: string;
  fetchImpl?: FetchLike;
  weight?: BinanceWeightTracker;
  now?: () => number;
}

export class UniverseSummaryService {
  private readonly fetchImpl: FetchLike;
  private readonly weight: BinanceWeightTracker;
  private readonly futuresData: FuturesDataClient;
  private readonly now: () => number;
  private cached: { key: string; at: number; value: WebUniverseSummaryResponse } | null = null;
  private inFlight: { key: string; promise: Promise<WebUniverseSummaryResponse> } | null = null;

  constructor(private readonly options: UniverseSummaryOptions) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
    this.weight = options.weight ?? new BinanceWeightTracker();
    this.now = options.now ?? Date.now;
    this.futuresData = new FuturesDataClient({
      baseUrl: options.futuresBaseUrl,
      weight: this.weight,
      fetchImpl: this.fetchImpl as unknown as typeof fetch,
    });
  }

  /** The summary for these symbols, from cache when it is fresh. */
  async summary(symbols: readonly SummarySymbol[]): Promise<WebUniverseSummaryResponse> {
    const key = symbols.map((s) => s.id).join(',');
    const now = this.now();
    if (this.cached && this.cached.key === key && now - this.cached.at < CACHE_TTL_MS) return this.cached.value;
    if (this.inFlight && this.inFlight.key === key) return this.inFlight.promise;

    const promise = this.read(symbols).then((value) => {
      this.cached = { key, at: this.now(), value };
      return value;
    }).finally(() => {
      if (this.inFlight?.promise === promise) this.inFlight = null;
    });
    this.inFlight = { key, promise };
    return promise;
  }

  private async read(symbols: readonly SummarySymbol[]): Promise<WebUniverseSummaryResponse> {
    if (this.weight.used1m(this.now()) > WEIGHT_CEILING_1M) {
      throw new VenueUnavailableError(`Binance weight above ${WEIGHT_CEILING_1M}/min; not adding to it`);
    }
    // The two all-symbol calls are the list's backbone: without them there is nothing to show.
    const [tickers, premium] = await Promise.all([
      this.getArray('/fapi/v1/ticker/24hr', TICKER_WEIGHT, (row) => Ticker24hRowSchema.parse(row)),
      this.getArray('/fapi/v1/premiumIndex', PREMIUM_WEIGHT, (row) => PremiumIndexSummaryRowSchema.parse(row)),
    ]) as [Ticker24hRow[], PremiumIndexSummaryRow[]];
    // Open interest is per symbol and optional: a symbol whose call fails shows a dash.
    const listed = new Set(tickers.map((t) => t.symbol));
    const oiBySymbol = await this.openInterest(symbols.filter((s) => listed.has(s.id)).map((s) => s.id));
    return {
      asOfMs: this.now(),
      venue: 'binance-perp',
      rows: assembleSummary(symbols, tickers, premium, oiBySymbol),
    };
  }

  private async getArray<T>(path: string, weight: number, parse: (row: unknown) => T): Promise<T[]> {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(`${this.options.futuresBaseUrl.replace(/\/$/, '')}${path}`);
    } catch (error) {
      throw new VenueUnavailableError(`Binance ${path}: ${(error as Error).message}`);
    } finally {
      this.weight.recordCall(weight);
    }
    this.weight.recordFromHeaders(response.headers);
    if (!response.ok) throw new VenueUnavailableError(`Binance ${path}: HTTP ${response.status} ${response.statusText}`);
    const body = await response.json();
    if (!Array.isArray(body)) throw new VenueUnavailableError(`Binance ${path}: expected an array, got ${typeof body}`);
    // A row that fails its schema throws: a renamed field must be loud, not a column of dashes.
    return body.map(parse);
  }

  private async openInterest(ids: readonly string[]): Promise<Map<string, OiHistRow[]>> {
    const out = new Map<string, OiHistRow[]>();
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < ids.length) {
        const id = ids[next++];
        try {
          const rows = await this.futuresData.fetchPage<unknown>({ endpoint: 'openInterestHist', symbol: id, period: '1h', limit: 25 });
          out.set(id, rows.map((row) => OiHistRowSchema.parse(row)));
        } catch {
          // one coin's dash, not the list's failure
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(OI_CONCURRENCY, ids.length) }, worker));
    return out;
  }
}
