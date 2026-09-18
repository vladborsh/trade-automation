import { z } from 'zod';

/**
 * architecture/live-signal-server.md §3.1. 'bybit' and 'hyperliquid' (architecture/aggregate-oi.md
 * §3) are genuine venues but metric-only today: they appear as aggregate members, not in
 * instruments.yaml, so no candle ingestion or venue status exists for them.
 */
export const VenueSchema = z.enum(['binance', 'capitalcom', 'bybit', 'hyperliquid']);
export type Venue = z.infer<typeof VenueSchema>;

/** `${venue}:${venue-native symbol}`, e.g. 'binance:BTCUSDT', 'capitalcom:US100' */
export type InstrumentId = `${Venue}:${string}`;

export const InstrumentIdSchema = z
  .string()
  .refine((v): v is InstrumentId => {
    const [venue, ...rest] = v.split(':');
    return VenueSchema.safeParse(venue).success && rest.join(':').length > 0;
  }, { message: 'InstrumentId must be "<venue>:<symbol>"' }) as z.ZodType<InstrumentId>;

export const AssetClassSchema = z.enum(['crypto-perp', 'index-cfd', 'forex-cfd', 'equity']);
export type AssetClass = z.infer<typeof AssetClassSchema>;

export const InstrumentSchema = z.object({
  id: InstrumentIdSchema,
  venue: VenueSchema,
  symbol: z.string().min(1),
  assetClass: AssetClassSchema,
  displayName: z.string().min(1),
  pricePrecision: z.number().int().min(0),
  quoteCurrency: z.string().min(1),
  sessionTimezone: z.string().min(1),
});
export type Instrument = z.infer<typeof InstrumentSchema>;

export const VenueStatusSchema = z.enum(['up', 'degraded', 'down', 'closed']);
export type VenueStatus = z.infer<typeof VenueStatusSchema>;
