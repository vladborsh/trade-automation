import { z } from 'zod';
import { EconomicEventSchema } from '../calendar';

/**
 * IB-059 — the economic calendar on the insight dashboard. The event is the backtest app's own
 * `EconomicEvent` (`../calendar.ts`): one feed, one mapper, one shape, so a field added to the
 * feed is added for both apps or neither.
 *
 * The bot fetches the feed once per UTC day (IB-058), so `actual` usually arrives a day after
 * release. `lastFetchedAt` is on the wire so a page can say how old its picture is.
 */

/** `/api/web/calendar/events` refuses a window wider than this (`400 RANGE_TOO_WIDE`). */
export const WEB_MAX_CALENDAR_RANGE_DAYS = 90;
/** `/api/web/calendar/upcoming` caps `withinMin` here: it is for alerts, not for browsing. */
export const WEB_MAX_CALENDAR_UPCOMING_MIN = 24 * 60;
/** What the chart and the alerts read when the caller names no filter. */
export const WEB_CALENDAR_DEFAULT_CURRENCY = 'USD';
export const WEB_CALENDAR_DEFAULT_IMPACTS = ['high', 'holiday'] as const;

export const WebCalendarEventsResponseSchema = z.object({
  /** Latest revision of each event, `scheduledAt` ascending. Cancelled events are left out. */
  events: z.array(EconomicEventSchema),
  /** Epoch ms of the bot's last successful feed fetch; null before the first. */
  lastFetchedAt: z.number().int().nullable(),
});
export type WebCalendarEventsResponse = z.infer<typeof WebCalendarEventsResponseSchema>;
