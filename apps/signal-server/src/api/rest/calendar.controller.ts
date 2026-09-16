import { Controller, Get, Inject, NotFoundException, Param, Query, ServiceUnavailableException, UsePipes } from '@nestjs/common';
import {
  CalendarEventDetailResponse,
  CalendarEventsQuery,
  CalendarEventsQuerySchema,
  CalendarEventsResponse,
  CalendarNotificationsQuery,
  CalendarNotificationsQuerySchema,
  CalendarNotificationsResponse,
  CalendarStatusResponse,
  CalendarWeekQuery,
  CalendarWeekQuerySchema,
  CalendarWeekResponse,
  eventDayNY,
  eventWeekWindowNY,
} from '@trade-automation/contracts';
import { AppConfigService } from '../../config/config.service';
import { EVENT_STORE, EventStore } from '../../storage/event-store.port';
import { CalendarCache } from '../../calendar/calendar-cache.service';
import { CalendarIngestionService } from '../../calendar/calendar-ingestion.service';
import { ZodValidationPipe } from '../zod-validation.pipe';

const IMPACT_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, holiday: 0, unknown: 0 };

/**
 * architecture/economic-calendar.md §6.1, §8 — CALENDAR_ENABLED=false: every route returns
 * 503 "calendar disabled" rather than 404, so a client can tell "not deployed" from "turned off."
 */
@Controller('api/calendar')
export class CalendarController {
  constructor(
    private readonly config: AppConfigService,
    private readonly cache: CalendarCache,
    private readonly ingestion: CalendarIngestionService,
    @Inject(EVENT_STORE) private readonly store: EventStore,
  ) {}

  private assertEnabled(): void {
    if (!this.config.env.get('CALENDAR_ENABLED')) {
      throw new ServiceUnavailableException('calendar disabled');
    }
  }

  @Get('events')
  @UsePipes(new ZodValidationPipe(CalendarEventsQuerySchema))
  async events(@Query() query: CalendarEventsQuery): Promise<CalendarEventsResponse> {
    this.assertEnabled();
    const { from, to, country, impact, status, seriesId, limit } = query;

    const cached = this.cache.queryByScheduled(from, to);
    let events = cached.length > 0 ? cached : await this.store.queryByScheduled(from, to);

    const countries = country === undefined ? null : Array.isArray(country) ? country : [country];
    if (countries) events = events.filter((e) => countries.includes(e.country));
    if (impact) events = events.filter((e) => IMPACT_RANK[e.impact] >= IMPACT_RANK[impact]);
    if (status) events = events.filter((e) => e.status === status);
    else events = events.filter((e) => e.status !== 'removed');
    if (seriesId) events = events.filter((e) => e.seriesId === seriesId);

    return events.slice(0, limit);
  }

  @Get('week')
  @UsePipes(new ZodValidationPipe(CalendarWeekQuerySchema))
  async week(@Query() query: CalendarWeekQuery): Promise<CalendarWeekResponse> {
    this.assertEnabled();
    const at = query.at ?? Date.now();
    const { from, to } = eventWeekWindowNY(at);

    const cached = this.cache.queryByScheduled(from, to - 1);
    const events = (cached.length > 0 ? cached : await this.store.queryByScheduled(from, to - 1)).filter(
      (e) => e.status !== 'removed',
    );

    const day: string[] = [];
    for (let d = from; d < to; d += 24 * 60 * 60_000) day.push(eventDayNY(d + 12 * 60 * 60_000));

    return { from, to, day: day.slice(0, 7) as [string, string, string, string, string, string, string], events };
  }

  @Get('notifications')
  @UsePipes(new ZodValidationPipe(CalendarNotificationsQuerySchema))
  async notifications(@Query() query: CalendarNotificationsQuery): Promise<CalendarNotificationsResponse> {
    this.assertEnabled();
    const now = Date.now();
    const from = query.from ?? now - 48 * 60 * 60_000;
    const to = query.to ?? now;
    const rows = await this.store.queryNotifications(from, to);
    return rows.sort((a, b) => b.at - a.at).slice(0, query.limit);
  }

  @Get('status')
  async status(): Promise<CalendarStatusResponse> {
    this.assertEnabled();
    return this.ingestion.status();
  }

  @Get('events/:id')
  async eventDetail(@Param('id') id: string): Promise<CalendarEventDetailResponse> {
    this.assertEnabled();
    const event = this.cache.get(id) ?? (await this.store.get(id));
    if (!event) throw new NotFoundException(`No calendar event with id ${id}`);
    const revisions = await this.store.queryRevisions(id);
    return { event, revisions };
  }
}
