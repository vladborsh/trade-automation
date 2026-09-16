import { z } from 'zod';
import { CandleSchema } from './candle';
import {
  CalendarNotificationSchema,
  EconomicEventSchema,
  EventImpactSchema,
  EventRevisionSchema,
} from './calendar';
import { InstrumentIdSchema, InstrumentSchema, VenueStatusSchema } from './instrument';
import { MetricKindSchema, MetricPointSchema } from './metric';
import { SignalSchema } from './signal';
import { IndicatorPointSchema, IndicatorSeriesSpecSchema, StrategyTierSchema } from './strategy';
import { TimeframeSchema } from './timeframe';

/** architecture/live-signal-server.md §3.5 — REST wire contract. */

export const InstrumentsResponseSchema = z.array(
  InstrumentSchema.extend({ venueStatus: VenueStatusSchema }),
);
export type InstrumentsResponse = z.infer<typeof InstrumentsResponseSchema>;

export const CandlesQuerySchema = z.object({
  instrument: InstrumentIdSchema,
  timeframe: TimeframeSchema,
  from: z.coerce.number().int().nonnegative(),
  to: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().min(1).max(5000).default(1500),
});
export type CandlesQuery = z.infer<typeof CandlesQuerySchema>;

export const CandlesResponseSchema = z.array(CandleSchema);
export type CandlesResponse = z.infer<typeof CandlesResponseSchema>;

/**
 * architecture/live-signal-server.md §12.2/§12.5 item 4 — "an explicit signal, not a silent
 * empty 200" for a `GET /api/candles` request whose `from` predates a Capital.com vendor
 * retention floor (§12.4). Kept as a response *header* rather than changing
 * `CandlesResponseSchema`'s shape from an array to an object: the body stays a plain
 * (possibly empty) `Candle[]` either way, so an unmodified client keeps working exactly as
 * before — it just sees a legitimately-empty array, now accompanied by machine-readable
 * metadata a future client update can read. `X-Vendor-Floor-Date` (ISO 8601, UTC) accompanies
 * it when the specific floor date is known.
 */
export const VENDOR_FLOOR_REACHED_HEADER = 'x-vendor-floor-reached';
export const VENDOR_FLOOR_DATE_HEADER = 'x-vendor-floor-date';

export const SignalsQuerySchema = z.object({
  instrument: InstrumentIdSchema,
  from: z.coerce.number().int().nonnegative(),
  to: z.coerce.number().int().nonnegative(),
  strategyId: z.string().optional(),
});
export type SignalsQuery = z.infer<typeof SignalsQuerySchema>;

export const SignalsResponseSchema = z.array(SignalSchema);
export type SignalsResponse = z.infer<typeof SignalsResponseSchema>;

export const StrategyStatusSchema = z.enum(['warming', 'live', 'error']);
export type StrategyStatus = z.infer<typeof StrategyStatusSchema>;

export const StrategiesResponseSchema = z.array(
  z.object({
    id: z.string(),
    enabled: z.boolean(),
    instruments: z.array(InstrumentIdSchema),
    timeframe: TimeframeSchema,
    warmupBars: z.number().int().nonnegative(),
    status: StrategyStatusSchema,
    /** architecture/live-signal-server.md §11.4 — added for the research-tier VWAP plug-in. */
    tier: StrategyTierSchema,
    displayName: z.string().min(1),
    description: z.string().min(1),
    minBars: z.number().int().nonnegative().optional(),
    indicators: z.array(IndicatorSeriesSpecSchema).optional(),
  }),
);
export type StrategiesResponse = z.infer<typeof StrategiesResponseSchema>;

/** architecture/live-signal-server.md §11.4 — GET /api/indicators. */
export const IndicatorsQuerySchema = z.object({
  instrument: InstrumentIdSchema,
  from: z.coerce.number().int().nonnegative(),
  to: z.coerce.number().int().nonnegative(),
  strategyId: z.string().optional(),
});
export type IndicatorsQuery = z.infer<typeof IndicatorsQuerySchema>;

export const IndicatorsResponseSchema = z.array(IndicatorPointSchema);
export type IndicatorsResponse = z.infer<typeof IndicatorsResponseSchema>;

/** architecture/chart-layouts.md §4.5 — GET /api/metrics. */
export const MetricsQuerySchema = z.object({
  instrument: InstrumentIdSchema,
  metric: MetricKindSchema,
  timeframe: TimeframeSchema,
  from: z.coerce.number().int().nonnegative(),
  to: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().min(1).max(5000).default(1500),
});
export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;

export const MetricsResponseSchema = z.array(MetricPointSchema);
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;

/** architecture/live-signal-server.md §12.3 — Phase 2 async deepening progress per (instrument, timeframe). */
export const BackfillStatusSchema = z.enum(['deepening', 'complete']);
export type BackfillStatus = z.infer<typeof BackfillStatusSchema>;

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeSeconds: z.number().nonnegative(),
  instruments: z.array(
    z.object({
      instrument: InstrumentIdSchema,
      lastClosedCandleAge: z.number().nonnegative().nullable(),
      gapCount24h: z.number().int().nonnegative(),
      feedLag: z.number().nonnegative().nullable(),
      /**
       * §12.3/§12.5 item 5 — one entry per configured `Timeframe`. Only `1m` currently tracks a
       * real Phase 2 pass; every other timeframe reads `'complete'` (native coarse timeframes
       * finish synchronously in Phase 1, and 5m/15m ride along with 1m's own deepening without
       * separate tracking).
       */
      backfillStatus: z.array(z.object({ timeframe: TimeframeSchema, status: BackfillStatusSchema })),
    }),
  ),
  /** architecture/chart-layouts.md §4.4 — additive; default [] leaves DevOps' existing alarm design untouched. */
  metrics: z
    .array(
      z.object({
        instrument: InstrumentIdSchema,
        metric: MetricKindSchema,
        lastObservationAge: z.number().nonnegative().nullable(),
      }),
    )
    .default([]),
  /** architecture/economic-calendar.md §6.1 — additive; null fields when the module is disabled. */
  calendar: z
    .object({
      lastSuccessfulPollAge: z.number().nonnegative().nullable(),
      eventsInWindow: z.number().int().nonnegative(),
    })
    .nullable()
    .default(null),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** architecture/economic-calendar.md §6.1 — GET /api/calendar/events. */
export const CalendarEventsQuerySchema = z.object({
  from: z.coerce.number().int().nonnegative(),
  to: z.coerce.number().int().nonnegative(),
  country: z.union([z.string(), z.array(z.string())]).optional(),
  impact: EventImpactSchema.optional(), // minimum level (low|medium|high)
  status: z.enum(['scheduled', 'released', 'removed']).optional(),
  seriesId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(10_000).default(2000),
});
export type CalendarEventsQuery = z.infer<typeof CalendarEventsQuerySchema>;

export const CalendarEventsResponseSchema = z.array(EconomicEventSchema);
export type CalendarEventsResponse = z.infer<typeof CalendarEventsResponseSchema>;

/** architecture/economic-calendar.md §6.1 — GET /api/calendar/week. */
export const CalendarWeekQuerySchema = z.object({
  at: z.coerce.number().int().nonnegative().optional(),
});
export type CalendarWeekQuery = z.infer<typeof CalendarWeekQuerySchema>;

export const CalendarWeekResponseSchema = z.object({
  from: z.number().int(),
  to: z.number().int(),
  day: z.array(z.string()).length(7),
  events: z.array(EconomicEventSchema),
});
export type CalendarWeekResponse = z.infer<typeof CalendarWeekResponseSchema>;

/** architecture/economic-calendar.md §6.1 — GET /api/calendar/events/:id. */
export const CalendarEventDetailResponseSchema = z.object({
  event: EconomicEventSchema,
  revisions: z.array(EventRevisionSchema),
});
export type CalendarEventDetailResponse = z.infer<typeof CalendarEventDetailResponseSchema>;

/** architecture/economic-calendar.md §6.1 — GET /api/calendar/notifications. */
export const CalendarNotificationsQuerySchema = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type CalendarNotificationsQuery = z.infer<typeof CalendarNotificationsQuerySchema>;

export const CalendarNotificationsResponseSchema = z.array(CalendarNotificationSchema);
export type CalendarNotificationsResponse = z.infer<typeof CalendarNotificationsResponseSchema>;

/** architecture/economic-calendar.md §6.1 — GET /api/calendar/status. */
export const CalendarStatusResponseSchema = z.object({
  lastPollAt: z.number().int().nullable(),
  lastSuccessAt: z.number().int().nullable(),
  lastEtag: z.string().nullable(),
  weekWindow: z.object({ from: z.number().int(), to: z.number().int() }),
  eventsInWindow: z.number().int().nonnegative(),
  nextPollAt: z.number().int().nullable(),
  hot: z.boolean(),
});
export type CalendarStatusResponse = z.infer<typeof CalendarStatusResponseSchema>;

/** architecture/live-signal-server.md §3.5 — WebSocket wire contract, JSON frames discriminated by `type`. */

export const WsSubscribeCandlesSchema = z.object({
  type: z.literal('subscribe'),
  topic: z.literal('candles'),
  instrument: InstrumentIdSchema,
  timeframe: TimeframeSchema,
});

export const WsUnsubscribeCandlesSchema = z.object({
  type: z.literal('unsubscribe'),
  topic: z.literal('candles'),
  instrument: InstrumentIdSchema,
  timeframe: TimeframeSchema,
});

export const WsSubscribeSignalsSchema = z.object({
  type: z.literal('subscribe'),
  topic: z.literal('signals'),
  instrument: InstrumentIdSchema,
});

export const WsUnsubscribeSignalsSchema = z.object({
  type: z.literal('unsubscribe'),
  topic: z.literal('signals'),
  instrument: InstrumentIdSchema,
});

/** architecture/chart-layouts.md §4.5 — `metrics` WS topic. */
export const WsSubscribeMetricsSchema = z.object({
  type: z.literal('subscribe'),
  topic: z.literal('metrics'),
  instrument: InstrumentIdSchema,
  metric: MetricKindSchema,
  timeframe: TimeframeSchema,
});

export const WsUnsubscribeMetricsSchema = z.object({
  type: z.literal('unsubscribe'),
  topic: z.literal('metrics'),
  instrument: InstrumentIdSchema,
  metric: MetricKindSchema,
  timeframe: TimeframeSchema,
});

/** architecture/economic-calendar.md §6.2 — `calendar` WS topic; no parameters, one stream for the whole calendar. */
export const WsSubscribeCalendarSchema = z.object({
  type: z.literal('subscribe'),
  topic: z.literal('calendar'),
});

export const WsUnsubscribeCalendarSchema = z.object({
  type: z.literal('unsubscribe'),
  topic: z.literal('calendar'),
});

export const WsPingSchema = z.object({ type: z.literal('ping') });

const WsSubscribeSchema = z.discriminatedUnion('topic', [
  WsSubscribeCandlesSchema,
  WsSubscribeSignalsSchema,
  WsSubscribeMetricsSchema,
  WsSubscribeCalendarSchema,
]);
const WsUnsubscribeSchema = z.discriminatedUnion('topic', [
  WsUnsubscribeCandlesSchema,
  WsUnsubscribeSignalsSchema,
  WsUnsubscribeMetricsSchema,
  WsUnsubscribeCalendarSchema,
]);

export const WsClientMessageSchema = z.union([WsSubscribeSchema, WsUnsubscribeSchema, WsPingSchema]);
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

export const WsCandleMessageSchema = z.object({ type: z.literal('candle'), candle: CandleSchema });
export const WsSignalMessageSchema = z.object({ type: z.literal('signal'), signal: SignalSchema });
/** architecture/live-signal-server.md §11.5 — delivered to every client subscribed to `signals` for the instrument. */
export const WsIndicatorMessageSchema = z.object({ type: z.literal('indicator'), point: IndicatorPointSchema });
/** architecture/chart-layouts.md §4.5 — one frame per observation, already bucketed to the subscribed timeframe. */
export const WsMetricMessageSchema = z.object({ type: z.literal('metric'), point: MetricPointSchema });
export const WsStatusMessageSchema = z.object({
  type: z.literal('status'),
  instrument: InstrumentIdSchema,
  venueStatus: VenueStatusSchema,
  lastClosedCandleTime: z.number().nullable(),
});
export const WsPongMessageSchema = z.object({ type: z.literal('pong'), serverTime: z.number() });

/** architecture/economic-calendar.md §6.2 — pushed on any created/updated/removed/actual change. */
export const WsCalendarEventMessageSchema = z.object({
  type: z.literal('calendarEvent'),
  event: EconomicEventSchema,
  change: z.enum(['created', 'updated', 'removed', 'actual']),
});
/** architecture/economic-calendar.md §6.2, §5 — a fired daily-digest or event-due notification. */
export const WsNotificationMessageSchema = z.object({
  type: z.literal('notification'),
  notification: CalendarNotificationSchema,
});

export const WsServerMessageSchema = z.discriminatedUnion('type', [
  WsCandleMessageSchema,
  WsSignalMessageSchema,
  WsIndicatorMessageSchema,
  WsMetricMessageSchema,
  WsStatusMessageSchema,
  WsPongMessageSchema,
  WsCalendarEventMessageSchema,
  WsNotificationMessageSchema,
]);
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
