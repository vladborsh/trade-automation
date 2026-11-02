import { Controller, Get, HttpException, Inject, Optional, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  WEB_MAX_CANDLE_BARS, WEB_MAX_LIQUIDATION_EVENTS, WEB_MAX_POINTS, WebLiquidationBucketSchema, WebMarketSchema,
  WebTimeframeSchema, WebVenueFilterSchema, type WebTimeframe,
  type WebCandlesResponse, type WebFundingResponse, type WebLiquidationEventsResponse,
  type WebLiquidationsResponse, type WebLongShortResponse, type WebOpenInterestResponse, type WebTopLiquidation,
} from '@trade-automation/contracts';
import { DB, type Db } from '../../db/db.port';
import { CandlesService } from '../market/candles.service';
import { bucketLiquidations, topLiquidations } from './liquidation-buckets';
import { barsTouched, checkRange, gridOffsetMs, thin, timeframeMs } from './range';
import * as repo from './pg/liquidations.repo';
import { FundingService } from '../market/funding.service';
import { OiLsService } from '../market/oi-ls.service';

/** The venues whose liquidations a symbol can have: one per spelling `venueSpellings` resolves. */
const LIQUIDATION_VENUES = WebVenueFilterSchema.options.filter((v) => v !== 'all').length;

/**
 * IB-031 — the instrument view's series (architecture/insight-bot-web-dashboard.md §4).
 *
 * Authenticated by `WebModule`'s module-wide guard: there is no decorator here on purpose, so
 * there is exactly one place that decides who may read the dashboard.
 *
 * Every endpoint validates its range through the same `checkRange`, so the 90-day 1m rule and
 * the point cap cannot drift apart between routes.
 */
@Controller('api/web/series')
export class SeriesController {
  constructor(
    @Inject(DB) private readonly db: Db | null,
    @Optional() private readonly candlesService?: CandlesService,
    @Optional() private readonly fundingService?: FundingService,
    @Optional() private readonly oiLsService?: OiLsService,
  ) {}

  private get required(): Db {
    if (!this.db) throw new HttpException({ code: 'NOT_FOUND', message: 'no database' }, 503);
    return this.db;
  }

  /** Parses and validates `from`/`to`/`tf`, or throws the wire error the contract names. */
  private range(from: string, to: string, tf: string) {
    const parsedTf = WebTimeframeSchema.safeParse(tf || '1m');
    if (!parsedTf.success) throw new HttpException({ code: 'BAD_REQUEST', message: 'unknown timeframe' }, 400);

    const checked = checkRange(Number(from), Number(to), parsedTf.data);
    if (!checked.ok) {
      const body = checked.code === 'RANGE_TOO_WIDE'
        ? { code: checked.code, message: checked.message, maxDays: checked.maxDays }
        : { code: checked.code, message: checked.message };
      throw new HttpException(body, 400);
    }
    return { ...checked, tf: parsedTf.data };
  }

  @Get('candles')
  async candles(
    @Query('symbol') symbol: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('tf') tf = '1m',
    @Query('venue') venue = 'binance',
    @Query('market') market = 'perp',
    @Res({ passthrough: true }) res?: Response,
  ): Promise<WebCandlesResponse> {
    const parsedMarket = WebMarketSchema.safeParse(market);
    if (!parsedMarket.success) throw new HttpException({ code: 'BAD_REQUEST', message: 'unknown market' }, 400);
    const { fromMs, toMs, tf: timeframe } = this.range(from, to, tf);

    // IB-063: read from Binance on demand, not from the tape (which starts 2026-09-28); WD-009
    // removed the tape's candle read. Only Binance is served, as the tape only ever held Binance candles.
    if (!this.candlesService) {
      throw new HttpException({ code: 'VENUE_UNAVAILABLE', message: 'candles not configured' }, 503);
    }
    if (venue !== 'binance') return { venue, market: parsedMarket.data, symbol, timeframe, candles: [], downsampled: false };
    const rows = await this.candlesService.candles(parsedMarket.data, symbol, timeframe, fromMs, toMs);
    // IB-066: a window holding the forming bar is a different answer five seconds later (the live
    // tail polls it); no cache between here and the chart may hand back the old one.
    if (this.candlesService.reachesFormingBar(timeframe, fromMs, toMs)) res?.setHeader('Cache-Control', 'no-store');
    const { rows: candles, downsampled } = thin(rows);
    return { venue, market: parsedMarket.data, symbol, timeframe, candles, downsampled };
  }

  /**
   * WD-009: settled funding per venue and Binance's predicted rate, from the venues on demand
   * (`market/funding.service.ts`) — the tape held only what the collectors had seen since the
   * process first started, so a fresh box showed none. Predicted is now one point (the venue keeps
   * no history of predictions). A venue that failed is named in `unavailable`, never sent as empty.
   */
  @Get('funding')
  async funding(
    @Query('symbol') symbol: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<WebFundingResponse> {
    const { fromMs, toMs } = this.range(from, to, '1m');
    if (!this.fundingService) throw notConfigured('funding');
    const answer = await this.fundingService.funding(symbol, fromMs, toMs);
    // settled is a step per venue; predicted is one point. Never merged: they mean different things.
    let downsampled = false;
    const settled = answer.settled.map(({ venue, points }) => {
      const thinned = thin(points);
      downsampled ||= thinned.downsampled;
      return { venue, points: thinned.rows };
    });
    return { symbol, settled, predicted: answer.predicted, downsampled, unavailable: answer.unavailable };
  }

  /** WD-009: Binance open interest from `/futures/data` on demand; ~30 days back (`coverageFrom`/`truncated`). */
  @Get('oi')
  async oi(
    @Query('symbol') symbol: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('venue') venue = 'binance',
  ): Promise<WebOpenInterestResponse> {
    const { fromMs, toMs } = this.range(from, to, '15m');
    onlyBinance(venue);
    if (!this.oiLsService) throw notConfigured('open interest');
    const answer = await this.oiLsService.openInterest(symbol, fromMs, toMs);
    const { rows: points, downsampled } = thin(answer.points);
    return { ...answer, points, downsampled };
  }

  /** WD-009: Binance long-short ratios from `/futures/data` on demand; ~30 days back. */
  @Get('ls')
  async ls(
    @Query('symbol') symbol: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('kind') kind = 'global_account',
    @Query('venue') venue = 'binance',
  ): Promise<WebLongShortResponse> {
    const kinds = ['global_account', 'top_account', 'top_position', 'taker'] as const;
    if (!kinds.includes(kind as (typeof kinds)[number])) {
      throw new HttpException({ code: 'BAD_REQUEST', message: 'unknown kind' }, 400);
    }
    const { fromMs, toMs } = this.range(from, to, '15m');
    onlyBinance(venue);
    if (!this.oiLsService) throw notConfigured('long-short');
    const answer = await this.oiLsService.longShort(symbol, kind as WebLongShortResponse['kind'], fromMs, toMs);
    const { rows: points, downsampled } = thin(answer.points);
    return { ...answer, points, downsampled };
  }

  @Get('liquidations')
  async liquidations(
    @Query('symbol') symbol: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('bucket') bucket = '1m',
    @Query('venue') venue = 'all',
  ): Promise<WebLiquidationsResponse> {
    const parsedBucket = WebLiquidationBucketSchema.safeParse(bucket);
    const parsedVenue = WebVenueFilterSchema.safeParse(venue);
    if (!parsedBucket.success || !parsedVenue.success) {
      throw new HttpException({ code: 'BAD_REQUEST', message: 'unknown bucket or venue' }, 400);
    }
    const { fromMs, toMs } = this.range(from, to, parsedBucket.data);

    const rows = await repo.liquidations(this.required, {
      symbol, fromMs, toMs, venue: parsedVenue.data === 'all' ? null : parsedVenue.data,
    });
    const bars = bucketLiquidations(rows, parsedBucket.data, fromMs, toMs);
    // IB-BUG-011: what the data delivered, beside what the caller asked for. Derived from the
    // rows, never from the filter — a list built from the request would re-assert the bug.
    const venuesPresent = [...new Set(rows.map((r) => r.venue))].sort();
    const { rows: thinned, downsampled } = thin(bars, WEB_MAX_POINTS);
    return {
      symbol,
      bucket: parsedBucket.data,
      venue: parsedVenue.data,
      venuesPresent,
      bars: thinned,
      // §12.2: Binance sends at most one forceOrder per second per symbol
      undercounted: parsedVenue.data === 'all' || parsedVenue.data === 'binance',
      downsampled,
    };
  }

  /**
   * IB-039 §12.5 — the events behind the price chart's markers.
   *
   * **Refuses rather than truncates.** A window holding more than `WEB_MAX_LIQUIDATION_EVENTS`
   * answers `400 RANGE_TOO_WIDE` with the `minUsd` that would have fitted, so the caller raises
   * its threshold or narrows its window knowingly. Quietly sending the first 2 000 would draw a
   * chart that goes calm halfway through a cascade — the same class of lie as IB-BUG-011.
   */
  @Get('liquidations/events')
  async liquidationEvents(
    @Query('symbol') symbol: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('min_usd') minUsd = '0',
    @Query('tf') tf?: string,
  ): Promise<WebLiquidationEventsResponse> {
    if (tf) return this.liquidationEventBuckets(symbol, from, to, minUsd, tf);
    const { fromMs, toMs } = this.range(from, to, '1m');
    const threshold = Math.max(0, Number(minUsd) || 0);

    const rows = await repo.liquidationEvents(this.required, {
      symbol, fromMs, toMs, minUsd: threshold, limit: WEB_MAX_LIQUIDATION_EVENTS,
    });

    if (rows.length > WEB_MAX_LIQUIDATION_EVENTS) {
      // the smallest event we WOULD have sent: raising min_usd past it brings the window under
      // the cap, so the error carries the fix rather than just the complaint
      const smallestSent = rows[WEB_MAX_LIQUIDATION_EVENTS - 1]?.usd ?? threshold;
      throw new HttpException(
        {
          code: 'RANGE_TOO_WIDE',
          message: `more than ${WEB_MAX_LIQUIDATION_EVENTS} liquidations in this window; raise min_usd above ${Math.ceil(smallestSent)} or narrow the range`,
          minUsd: Math.ceil(smallestSent),
        },
        400,
      );
    }

    return {
      symbol,
      minUsd: threshold,
      // back into time order: size order is how the cap picks, not how a chart draws
      events: [...rows].sort((a, b) => a.time - b.time),
      venuesPresent: [...new Set(rows.map((r) => r.venue))].sort(),
      undercounted: true,
    };
  }

  /**
   * IB-068 — `/liquidations/events?tf=…`: the same events grouped per `tf` bar on the server, one
   * row per (bar start, side, venue), so a window of any density draws its bubbles.
   *
   * **The bound replaces the 2 000 cap.** Rows ≤ bars × 2 sides × 3 venues, and the window may
   * touch at most `WEB_MAX_CANDLE_BARS` bars — the most candles the chart can ask for in one read,
   * so a window the chart draws always fits. That makes the ceiling 10 080 × 2 × 3 = 60 480 rows
   * (≈ 6 MB of JSON), reached only by a window where every bar has both sides liquidated on every
   * venue. A wider window is refused up front, before the query; a result over the bound (a venue
   * the count above does not know) is refused too. Neither is ever truncated.
   */
  private async liquidationEventBuckets(
    symbol: string, from: string, to: string, minUsd: string, tf: string,
  ): Promise<WebLiquidationEventsResponse> {
    const { fromMs, toMs, tf: timeframe } = this.range(from, to, tf);
    const threshold = Math.max(0, Number(minUsd) || 0);

    const bars = barsTouched(fromMs, toMs, timeframe);
    if (bars > WEB_MAX_CANDLE_BARS) {
      throw new HttpException({
        code: 'RANGE_TOO_WIDE',
        message: `this window spans ${bars} ${timeframe} bars; grouped liquidations serve at most ${WEB_MAX_CANDLE_BARS}`,
      }, 400);
    }
    const bound = bars * 2 * LIQUIDATION_VENUES;

    const rows = await repo.liquidationEventBuckets(this.required, {
      symbol, fromMs, toMs, minUsd: threshold,
      spanMs: timeframeMs(timeframe), offsetMs: gridOffsetMs(timeframe), limit: bound,
    });
    if (rows.length > bound) throw tooManyBuckets(bound, timeframe);

    return {
      symbol,
      minUsd: threshold,
      events: rows,
      venuesPresent: [...new Set(rows.map((r) => r.venue))].sort(),
      undercounted: true,
    };
  }

  @Get('liquidations/top')
  async liquidationsTop(
    @Query('symbol') symbol: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('n') n = '50',
    @Query('venue') venue = 'all',
  ): Promise<{ symbol: string; rows: WebTopLiquidation[] }> {
    const parsedVenue = WebVenueFilterSchema.safeParse(venue);
    if (!parsedVenue.success) throw new HttpException({ code: 'BAD_REQUEST', message: 'unknown venue' }, 400);
    const { fromMs, toMs } = this.range(from, to, '1m');

    const count = Math.min(Math.max(1, Number(n) || 50), 200);
    const rows = await repo.liquidations(this.required, {
      symbol, fromMs, toMs, venue: parsedVenue.data === 'all' ? null : parsedVenue.data,
    });
    return {
      symbol,
      rows: topLiquidations(rows, count).map((r) => ({
        time: Math.floor(r.ts / 1000), venue: r.venue, side: r.side,
        price: r.price, qty: r.qty, notional: r.notional,
      })),
    };
  }
}

/** More rows than bars × sides × venues: a venue the bound does not know. Refused, not cut. */
function tooManyBuckets(bound: number, tf: WebTimeframe): HttpException {
  return new HttpException({
    code: 'RANGE_TOO_WIDE',
    message: `more than ${bound} grouped ${tf} liquidation rows in this window; narrow the range`,
  }, 400);
}

/**
 * WD-009: OI and long-short come from Binance's `/futures/data` only. Bybit and OKX OI used to be
 * read from the tape; asking for them now is refused rather than answered with an empty series,
 * which a chart would read as "no open interest".
 */
function onlyBinance(venue: string): void {
  if (venue !== 'binance') {
    throw new HttpException({ code: 'BAD_REQUEST', message: `only venue=binance is served on demand, not ${venue}` }, 400);
  }
}

function notConfigured(what: string): HttpException {
  return new HttpException({ code: 'VENUE_UNAVAILABLE', message: `${what} not configured` }, 503);
}
