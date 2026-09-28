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
 *
 * IB-002 (insight-bot design §2.2, D3): the four venue-reported activity fields are **optional and
 * additive** — the Binance mappers fill them (REST columns 7–10, WS `q`/`n`/`V`/`Q`), every other
 * venue and signal-server's stores and wire types ignore them. `takerBuy*` minus the totals gives
 * taker-sell, which is what the CVD features of §8.2 are built from.
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
  /** Quote-asset volume of the bar (Binance REST column 7, WS `q`). */
  quoteVolume: z.number().nonnegative().optional(),
  /** Number of trades in the bar (REST column 8, WS `n`). */
  trades: z.number().int().nonnegative().optional(),
  /** Base-asset volume bought by the taker side (REST column 9, WS `V`). */
  takerBuyVolume: z.number().nonnegative().optional(),
  /** Quote-asset volume bought by the taker side (REST column 10, WS `Q`). */
  takerBuyQuoteVolume: z.number().nonnegative().optional(),
});
export type Candle = z.infer<typeof CandleSchema>;

export function candleKey(instrument: string, timeframe: string, openTime: number): string {
  return `${instrument}|${timeframe}|${openTime}`;
}
