import { Logger } from '@nestjs/common';
import type { WebFundingPoint, WebFundingResponse } from '@trade-automation/contracts';
import type { BinanceWeightTracker } from '../../venues/binance/binance-weight.tracker';
import type { PerpRest } from '../../venues/binance/perp.rest';
import type { BybitRest } from '../../venues/bybit/bybit.rest';
import type { BybitFundingHistoryRow } from '../../venues/bybit/payloads';
import type { OkxRest } from '../../venues/okx/okx-rest';
import { FUNDING_TTL_MS, windowKey, type TtlCache } from '../../venues/ttl-cache';
import { binanceFundingPoints, bybitFundingPoints, okxFundingPoints } from './funding-points';
import { WEIGHT_CEILING_1M } from './universe-summary.service';

/**
 * WD-008 step 2 — settled funding per venue and Binance's predicted rate, read from the venues on
 * demand. Nothing is written to Postgres. Additive: `/series/funding` still reads the tape until
 * WD-009 switches it.
 *
 * **Weight** (Binance, documented — WD-008 row): `/fapi/v1/fundingRate` 1, `/fapi/v1/premiumIndex?symbol=` 1.
 * So **2 per uncached read**, cached `FUNDING_TTL_MS` (60 s) per (symbol, window snapped to the
 * hour): at most 2 weight/min per open funding window, however many tabs show it. Bybit and OKX are
 * other venues with their own allowances: at most `BYBIT_MAX_PAGES` and OKX's own page walk.
 *
 * **One venue failing does not fail the answer**: its series is left out and named in
 * `unavailable`, so the panel says "no data from okx" instead of the whole chart going blank —
 * the per-venue honesty IB-BUG-011 was about. Binance is also left out (and named) when the shared
 * weight is above `WEIGHT_CEILING_1M`: this read never adds to a budget that is already nearly spent.
 */
export const FUNDING_CALL_WEIGHT = 1;
export const PREMIUM_INDEX_CALL_WEIGHT = 1;
/** 200 settlements a page: 10 pages is 6.8 years at 8 h — far past any window the panel asks for. */
export const BYBIT_MAX_PAGES = 10;
const HOUR_MS = 3_600_000;

export type FundingVenue = 'binance' | 'bybit' | 'okx';

export interface OnDemandFunding extends WebFundingResponse {
  /**
   * Venues whose data is missing because the read failed or was refused — never silently empty.
   * `binance` is listed when its settled series OR its predicted point is missing.
   */
  unavailable: FundingVenue[];
}

export interface VenueSpellings {
  bybit?: string;
  okx?: string;
}

export interface FundingServiceOptions {
  perp: PerpRest;
  bybit: BybitRest;
  okx: OkxRest;
  cache: TtlCache;
  weight: BinanceWeightTracker;
  /** The symbol as each venue spells it (universe.yaml); a venue with no spelling is skipped, not "unavailable". */
  spellings: (symbol: string) => VenueSpellings;
  now?: () => number;
}

export class FundingService {
  private readonly logger = new Logger(FundingService.name);
  private readonly now: () => number;

  constructor(private readonly options: FundingServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  async funding(symbol: string, fromMs: number, toMs: number): Promise<OnDemandFunding> {
    const key = windowKey({ venue: 'all', market: 'perp', symbol, tf: 'funding', fromMs, toMs }, HOUR_MS);
    return this.options.cache.getOrLoad(key, FUNDING_TTL_MS, () => this.load(symbol, fromMs, toMs), (v) => v.unavailable.length === 0);
  }

  private async load(symbol: string, fromMs: number, toMs: number): Promise<OnDemandFunding> {
    const spell = this.options.spellings(symbol);
    const reads: Array<[FundingVenue, Promise<WebFundingPoint[]>]> = [['binance', this.binanceSettled(symbol, fromMs, toMs)]];
    if (spell.bybit) reads.push(['bybit', this.bybitSettled(spell.bybit, fromMs, toMs)]);
    if (spell.okx) reads.push(['okx', this.okxSettled(spell.okx, fromMs, toMs)]);
    const [settledResults, predicted] = await Promise.all([
      Promise.allSettled(reads.map(([, p]) => p)),
      this.predicted(symbol).catch(() => null),
    ]);

    const settled: WebFundingResponse['settled'] = [];
    const unavailable: FundingVenue[] = [];
    settledResults.forEach((result, i) => {
      const venue = reads[i][0];
      if (result.status === 'fulfilled') settled.push({ venue, points: result.value });
      else {
        unavailable.push(venue);
        this.logger.warn(`funding ${venue} ${symbol}: ${(result.reason as Error).message}`);
      }
    });
    if (predicted === null && !unavailable.includes('binance')) unavailable.push('binance');
    settled.sort((a, b) => a.venue.localeCompare(b.venue));
    return { symbol, settled, predicted: predicted ?? [], downsampled: false, unavailable };
  }

  private refuseAboveCeiling(): void {
    const used = this.options.weight.used1m(this.now());
    if (used > WEIGHT_CEILING_1M) throw new Error(`Binance weight ${used} above ${WEIGHT_CEILING_1M}/min; not adding to it`);
  }

  private async binanceSettled(symbol: string, fromMs: number, toMs: number): Promise<WebFundingPoint[]> {
    this.refuseAboveCeiling();
    this.options.weight.recordCall(FUNDING_CALL_WEIGHT, this.now());
    return binanceFundingPoints(await this.options.perp.fundingRateRange(symbol, fromMs, toMs), fromMs, toMs);
  }

  /** The current predicted rate as one point at "now" — the venue keeps no history of predictions. */
  private async predicted(symbol: string): Promise<WebFundingPoint[]> {
    this.refuseAboveCeiling();
    this.options.weight.recordCall(PREMIUM_INDEX_CALL_WEIGHT, this.now());
    const row = await this.options.perp.premiumIndexOf(symbol);
    const rate = Number(row.lastFundingRate);
    if (row.lastFundingRate === '' || !Number.isFinite(rate)) throw new Error(`premiumIndex ${symbol}: lastFundingRate is not a number`);
    return [{ time: Math.floor(this.now() / 1000), rate }];
  }

  /** Bybit pages backward from `endTime`, newest first, 200 a page. */
  private async bybitSettled(venueSymbol: string, fromMs: number, toMs: number): Promise<WebFundingPoint[]> {
    const rows: BybitFundingHistoryRow[] = [];
    let endTime = toMs;
    for (let page = 0; page < BYBIT_MAX_PAGES; page += 1) {
      const batch = await this.options.bybit.fundingHistory(venueSymbol, endTime);
      if (batch.length === 0) break;
      rows.push(...batch);
      const oldest = Math.min(...batch.map((r) => Number(r.fundingRateTimestamp)));
      if (!Number.isFinite(oldest) || oldest <= fromMs || oldest >= endTime) break;
      endTime = oldest - 1;
    }
    return bybitFundingPoints(rows, fromMs, toMs);
  }

  /** OKX walks back from its newest settlement to `fromMs` (or its own wall, ~98 days). */
  private async okxSettled(instId: string, fromMs: number, toMs: number): Promise<WebFundingPoint[]> {
    const { rows } = await this.options.okx.fundingHistory(instId, { stopAtMs: fromMs });
    return okxFundingPoints(rows, fromMs, toMs);
  }
}
