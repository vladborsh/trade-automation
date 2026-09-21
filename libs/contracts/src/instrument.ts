import { z } from 'zod';

/** architecture/live-signal-server.md §3.1 */
export const VenueSchema = z.enum(['binance', 'capitalcom']);
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

const InstrumentObjectSchema = z.object({
  id: InstrumentIdSchema,
  venue: VenueSchema,
  symbol: z.string().min(1),
  assetClass: AssetClassSchema,
  displayName: z.string().min(1),
  pricePrecision: z.number().int().min(0),
  quoteCurrency: z.string().min(1),
  /**
   * backtest-app-system-design.md §1 D11 — defaults to `quoteCurrency` at parse time when
   * absent, so every pre-existing `instruments.yaml` entry and every caller that never heard
   * of this field keeps working unchanged. `USDT`-quoted entries declare `USD` explicitly
   * (decision 36: exactly two account-currency groups, USD and CHF, from configuration only).
   */
  sessionCurrency: z.string().min(1).optional(),
  sessionTimezone: z.string().min(1),
});

export const InstrumentSchema = InstrumentObjectSchema.transform((instrument) => ({
  ...instrument,
  sessionCurrency: instrument.sessionCurrency ?? instrument.quoteCurrency,
}));

/**
 * The *parsed* shape: `sessionCurrency` is required here, because `.parse()` always fills it
 * in above (D11, decision 36 — the grouping is enforced from configuration, not an optional
 * field a reader has to coalesce). `InstrumentObjectSchema`'s own `sessionCurrency` stays
 * optional — that's the pre-parse input shape, where the YAML/wire may omit it.
 */
export type Instrument = z.output<typeof InstrumentSchema>;

export const VenueStatusSchema = z.enum(['up', 'degraded', 'down', 'closed']);
export type VenueStatus = z.infer<typeof VenueStatusSchema>;
