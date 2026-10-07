import { Controller, Get, HttpException, Inject, Query } from '@nestjs/common';
import {
  WEB_MAX_POINTS, WebLiquidationBucketSchema, WebMarketSchema, WebTimeframeSchema,
  WebVenueFilterSchema,
  type WebCandlesResponse, type WebFundingResponse, type WebLiquidationsResponse,
  type WebLongShortResponse, type WebTopLiquidation,
} from '@trade-automation/contracts';
import { DB, type Db } from '../../db/db.port';
import { bucketLiquidations, topLiquidations } from './liquidation-buckets';
import { checkRange, strideFor, thin } from './range';
import * as repo from './pg/series.repo';

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
  constructor(@Inject(DB) private readonly db: Db | null) {}

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
  ): Promise<WebCandlesResponse> {
    const parsedMarket = WebMarketSchema.safeParse(market);
    if (!parsedMarket.success) throw new HttpException({ code: 'BAD_REQUEST', message: 'unknown market' }, 400);
    const { fromMs, toMs, tf: timeframe } = this.range(from, to, tf);

    const stride = strideFor(fromMs, toMs, timeframe);
    const rows = await repo.candles(this.required, {
      symbol, fromMs, toMs, stride, venue, market: parsedMarket.data, timeframe,
    });
    const { rows: candles, downsampled } = thin(rows);
    return { venue, market: parsedMarket.data, symbol, timeframe, candles, downsampled: downsampled || stride > 1 };
  }

  @Get('funding')
  async funding(
    @Query('symbol') symbol: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<WebFundingResponse> {
    const { fromMs, toMs } = this.range(from, to, '1m');
    const stride = strideFor(fromMs, toMs, '1m');

    const [settledRows, predictedRows] = await Promise.all([
      repo.settledFunding(this.required, { symbol, fromMs, toMs }),
      repo.predictedFunding(this.required, { symbol, fromMs, toMs, stride, venue: 'binance' }),
    ]);

    // settled is a step per venue; predicted is one line. Never merged: they mean different things.
    const byVenue = new Map<string, Array<{ time: number; rate: number }>>();
    for (const row of settledRows) {
      const list = byVenue.get(row.venue) ?? [];
      list.push({ time: row.time, rate: row.rate });
      byVenue.set(row.venue, list);
    }
    const predicted = thin(predictedRows);
    return {
      symbol,
      settled: [...byVenue.entries()].map(([venue, points]) => ({ venue, points })).sort((a, b) => a.venue.localeCompare(b.venue)),
      predicted: predicted.rows,
      downsampled: predicted.downsampled || stride > 1,
    };
  }

  @Get('oi')
  async oi(
    @Query('symbol') symbol: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('venue') venue = 'binance',
  ) {
    const { fromMs, toMs } = this.range(from, to, '15m');
    const stride = strideFor(fromMs, toMs, '15m');
    const rows = await repo.openInterest(this.required, { symbol, fromMs, toMs, stride, venue });
    const { rows: points, downsampled } = thin(rows);
    return { symbol, venue, points, downsampled: downsampled || stride > 1 };
  }

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
    const stride = strideFor(fromMs, toMs, '15m');
    const rows = await repo.longShort(this.required, { symbol, fromMs, toMs, stride, venue, kind });
    const { rows: points, downsampled } = thin(rows);
    return { symbol, kind: kind as WebLongShortResponse['kind'], points, downsampled: downsampled || stride > 1 };
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
