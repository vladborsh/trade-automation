import { z } from 'zod';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

/** architecture/economic-calendar.md §2.1 — ForexFactory weekly-feed event contract. */

export const EventImpactSchema = z.enum(['low', 'medium', 'high', 'holiday', 'unknown']);
export type EventImpact = z.infer<typeof EventImpactSchema>;

/** Currency code as the feed gives it (`USD`, `EUR`, …) or the literal `All`. */
export const EventCountrySchema = z.string().regex(/^[A-Z]{3}$|^All$/);
export type EventCountry = z.infer<typeof EventCountrySchema>;

export const EventStatusSchema = z.enum(['scheduled', 'released', 'removed']);
export type EventStatus = z.infer<typeof EventStatusSchema>;

export const EconomicEventSchema = z.object({
  id: z.string(), // D2: 'ff:832:2026-09-14' or 'ffx:<sha1>'
  source: z.literal('forexfactory'),
  seriesId: z.string().nullable(), // '832' — null only for ffx: ids
  sourceUrl: z.string().url().nullable(),
  title: z.string().min(1),
  country: EventCountrySchema,
  impact: EventImpactSchema,
  scheduledAt: z.number().int(), // ms UTC, from the JSON `date` (ISO with offset)
  scheduledDay: z.string(), // 'YYYY-MM-DD' — the ET calendar day of scheduledAt
  forecast: z.string().nullable(), // raw string; '' -> null
  previous: z.string().nullable(),
  actual: z.string().nullable(),
  actualSource: z.enum(['feed', 'next-previous', 'provider']).nullable(),
  actualAt: z.number().int().nullable(), // ms UTC when `actual` was set
  status: EventStatusSchema,
  firstSeenAt: z.number().int(), // ms UTC of the poll that created the record
  lastSeenAt: z.number().int(), // ms UTC of the last poll containing it
  revision: z.number().int().min(1), // bumps on every field change
});
export type EconomicEvent = z.infer<typeof EconomicEventSchema>;

/** Append-only audit row, one per change. */
export const EventRevisionSchema = z.object({
  eventId: z.string(),
  revision: z.number().int(),
  at: z.number().int(), // poll time, ms UTC
  change: z.enum(['created', 'updated', 'removed', 'actual']),
  before: EconomicEventSchema.partial().nullable(), // only the changed fields
  after: EconomicEventSchema.partial(),
});
export type EventRevision = z.infer<typeof EventRevisionSchema>;

export const CalendarNotificationKindSchema = z.enum(['daily-digest', 'event-due']);
export type CalendarNotificationKind = z.infer<typeof CalendarNotificationKindSchema>;

export const CalendarNotificationSchema = z.object({
  id: z.string(), // 'digest:2026-09-16' | 'due:<scheduledAt ms>' — deterministic
  kind: CalendarNotificationKindSchema,
  at: z.number().int(), // ms UTC when it fired
  day: z.string().optional(), // digest: the ET day it covers
  events: z.array(EconomicEventSchema), // digest: the day's events; event-due: every event at that instant
  title: z.string(), // server-rendered, plain text, <= 80 chars
});
export type CalendarNotification = z.infer<typeof CalendarNotificationSchema>;

const NY_TZ = 'America/New_York';

/** Pure, unit-tested: the ET calendar day of `scheduledAt`, DST-correct. */
export function eventDayNY(scheduledAt: number): string {
  const zoned = toZonedTime(new Date(scheduledAt), NY_TZ);
  const y = zoned.getFullYear();
  const m = String(zoned.getMonth() + 1).padStart(2, '0');
  const d = String(zoned.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Sun 00:00 -> Sat 24:00 America/New_York window containing `anyMsInWeek`, as ms UTC
 * (the feed's own week convention, architecture/economic-calendar.md §1.2).
 */
export function eventWeekWindowNY(anyMsInWeek: number): { from: number; to: number } {
  const zoned = toZonedTime(new Date(anyMsInWeek), NY_TZ);
  const weekday = zoned.getDay(); // 0 = Sunday
  const sunday = new Date(zoned);
  sunday.setDate(zoned.getDate() - weekday);
  sunday.setHours(0, 0, 0, 0);
  const nextSunday = new Date(sunday);
  nextSunday.setDate(sunday.getDate() + 7);

  const from = fromZonedTime(sunday, NY_TZ).getTime();
  const to = fromZonedTime(nextSunday, NY_TZ).getTime();
  return { from, to };
}

/**
 * Research convenience, never used for identity: '3.75%'->3.75, '8.3K'->8300, '480B'->4.8e11,
 * '3-0-6' (vote split) and '<1.25%' (BoJ rate band) -> null (not a single clean number).
 */
export function parseFeedValue(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes('-') && !/^-/.test(trimmed)) return null; // e.g. '3-0-6'
  if (trimmed.startsWith('<') || trimmed.startsWith('>')) return null; // e.g. '<1.25%'
  if (trimmed.includes('|')) return null; // e.g. bond-auction '3.65|1.3'

  const match = /^(-?\d+(?:\.\d+)?)([KMBT%]?)$/.exec(trimmed);
  if (!match) return null;
  const value = Number(match[1]);
  if (Number.isNaN(value)) return null;

  const suffix = match[2];
  switch (suffix) {
    case 'K':
      return value * 1e3;
    case 'M':
      return value * 1e6;
    case 'B':
      return value * 1e9;
    case 'T':
      return value * 1e12;
    case '%':
    case '':
      return value;
    default:
      return null;
  }
}
