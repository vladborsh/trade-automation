import { Controller, Get, HttpException, Inject, Logger, Query } from '@nestjs/common';
import type { WebAlertMarksResponse } from '@trade-automation/contracts';
import { DB, type Db } from '../../db/db.port';
import { alertMarksResponse } from './alert-marks';
import { alertMarkRows } from './pg/alert-marks.repo';
import { checkRange } from './range';

/**
 * IB-129 (alerts design §5) — `GET /api/web/series/alert-marks?symbol&from&to` (epoch ms, `to` exclusive):
 * the liquidation and funding alerts of one coin in the chart's window, for its marks. One DB read, no venue
 * call, no cache: the read is a few rows on an index, and a cache would hide a fresh alert for its lifetime.
 *
 * Behind `WebModule`'s module-wide guard, like the other series routes. Any window width is accepted: the
 * rows are sparse (a few a day), and the answer is capped at `WEB_MAX_ALERT_MARKS`, newest kept, saying so.
 */
@Controller('api/web/series')
export class AlertMarksController {
  private readonly logger = new Logger(AlertMarksController.name);

  constructor(@Inject(DB) private readonly db: Db | null) {}

  @Get('alert-marks')
  async alertMarks(@Query('symbol') symbol: string, @Query('from') from: string, @Query('to') to: string): Promise<WebAlertMarksResponse> {
    if (!/^[A-Z0-9]{2,30}$/.test(symbol ?? '')) throw new HttpException({ code: 'BAD_REQUEST', message: 'unknown symbol' }, 400);
    // '1d': the only width rule is the 1m one, which is about bars, not about these rows
    const range = checkRange(Number(from), Number(to), '1d');
    if (!range.ok) throw new HttpException({ code: range.code, message: range.message }, 400);
    if (!this.db) throw new HttpException({ code: 'NOT_FOUND', message: 'no database' }, 503);
    const { response, dropped } = alertMarksResponse(symbol, await alertMarkRows(this.db, symbol, range.fromMs, range.toMs));
    if (dropped > 0) this.logger.warn(`alert-marks ${symbol}: ${dropped} journal row(s) whose details break the contract were left out`);
    return response;
  }
}
