import { Controller, Get, HttpException, Inject, Query } from '@nestjs/common';
import type { WebCalendarEventsResponse } from '@trade-automation/contracts';
import { DB, type Db } from '../../db/db.port';
import { parseCalendarWindow, parseUpcoming, type CalendarQueryResult, type CalendarWindow } from './calendar-query';
import * as repo from './pg/calendar.repo';

/**
 * IB-059 — the economic calendar for the dashboard: events for the instrument chart, and the
 * next hour's events for the browser alerts. Authenticated by `WebModule`'s module-wide guard,
 * like every other `/api/web` controller — no decorator here on purpose.
 */
@Controller('api/web/calendar')
export class CalendarController {
  constructor(@Inject(DB) private readonly db: Db | null) {}

  private get required(): Db {
    if (!this.db) throw new HttpException({ code: 'NOT_FOUND', message: 'no database' }, 503);
    return this.db;
  }

  private window(result: CalendarQueryResult): CalendarWindow {
    if (result.ok) return result.query;
    const body = result.code === 'RANGE_TOO_WIDE'
      ? { code: result.code, message: result.message, maxDays: result.maxDays }
      : { code: result.code, message: result.message };
    throw new HttpException(body, 400);
  }

  private async read(window: CalendarWindow, now: number): Promise<WebCalendarEventsResponse> {
    const db = this.required;
    const [events, lastFetchedAt] = await Promise.all([repo.calendarEvents(db, window, now), repo.lastFetchedAt(db)]);
    return { events, lastFetchedAt };
  }

  /** `?from&to` (epoch ms, `to` exclusive, ≤ 90 days) `&currency=USD&impact=high,holiday`. */
  @Get('events')
  async events(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('currency') currency?: string,
    @Query('impact') impact?: string,
  ): Promise<WebCalendarEventsResponse> {
    const now = Date.now();
    return this.read(this.window(parseCalendarWindow(from, to, currency, impact)), now);
  }

  /** `?withinMin=60` — high-impact USD events from 5 minutes ago to `withinMin` ahead. */
  @Get('upcoming')
  async upcoming(
    @Query('withinMin') withinMin?: string,
    @Query('currency') currency?: string,
    @Query('impact') impact?: string,
  ): Promise<WebCalendarEventsResponse> {
    const now = Date.now();
    return this.read(this.window(parseUpcoming(now, withinMin, currency, impact)), now);
  }
}
