import { z } from 'zod';
import { CandleSchema } from './candle';
import { InstrumentIdSchema, InstrumentSchema, VenueStatusSchema } from './instrument';
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

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeSeconds: z.number().nonnegative(),
  instruments: z.array(
    z.object({
      instrument: InstrumentIdSchema,
      lastClosedCandleAge: z.number().nonnegative().nullable(),
      gapCount24h: z.number().int().nonnegative(),
      feedLag: z.number().nonnegative().nullable(),
    }),
  ),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

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

export const WsPingSchema = z.object({ type: z.literal('ping') });

const WsSubscribeSchema = z.discriminatedUnion('topic', [
  WsSubscribeCandlesSchema,
  WsSubscribeSignalsSchema,
]);
const WsUnsubscribeSchema = z.discriminatedUnion('topic', [
  WsUnsubscribeCandlesSchema,
  WsUnsubscribeSignalsSchema,
]);

export const WsClientMessageSchema = z.union([WsSubscribeSchema, WsUnsubscribeSchema, WsPingSchema]);
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

export const WsCandleMessageSchema = z.object({ type: z.literal('candle'), candle: CandleSchema });
export const WsSignalMessageSchema = z.object({ type: z.literal('signal'), signal: SignalSchema });
/** architecture/live-signal-server.md §11.5 — delivered to every client subscribed to `signals` for the instrument. */
export const WsIndicatorMessageSchema = z.object({ type: z.literal('indicator'), point: IndicatorPointSchema });
export const WsStatusMessageSchema = z.object({
  type: z.literal('status'),
  instrument: InstrumentIdSchema,
  venueStatus: VenueStatusSchema,
  lastClosedCandleTime: z.number().nullable(),
});
export const WsPongMessageSchema = z.object({ type: z.literal('pong'), serverTime: z.number() });

export const WsServerMessageSchema = z.discriminatedUnion('type', [
  WsCandleMessageSchema,
  WsSignalMessageSchema,
  WsIndicatorMessageSchema,
  WsStatusMessageSchema,
  WsPongMessageSchema,
]);
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
