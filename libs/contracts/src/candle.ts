import { z } from 'zod';
import { InstrumentIdSchema } from './instrument';
import { TimeframeSchema } from './timeframe';

const OhlcSchema = z.object({
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
});

export const CandleSourceSchema = z.enum([
  'venue-stream',
  'venue-rest',
  'venue-native',
  'resampled',
  'storage',
]);
export type CandleSource = z.infer<typeof CandleSourceSchema>;

/**
 * architecture/live-signal-server.md §3.3.
 * Identity is (instrument, timeframe, openTime); storage writes are upserts on that key.
 * `openTime` must always come from the venue payload, never from the local clock —
 * see §1's cmc-bot-main Binance bug (openTime stamped from Date.now() instead of kline.startTime).
 */
export const CandleSchema = z.object({
  instrument: InstrumentIdSchema,
  timeframe: TimeframeSchema,
  openTime: z.number().int().nonnegative(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nonnegative(),
  closed: z.boolean(),
  source: CandleSourceSchema,
  bid: OhlcSchema.optional(),
  ask: OhlcSchema.optional(),
});
export type Candle = z.infer<typeof CandleSchema>;

export function candleKey(instrument: string, timeframe: string, openTime: number): string {
  return `${instrument}|${timeframe}|${openTime}`;
}
