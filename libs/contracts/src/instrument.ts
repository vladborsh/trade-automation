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

/**
 * `sessionCurrency` stays optional on the inferred `Instrument` type (from the pre-transform
 * object schema) even though `.parse()` always fills it in below — so every existing literal
 * `const x: Instrument = {...}` that predates D11 keeps compiling unchanged, while every actual
 * parse (config load, wire response) gets the resolved value.
 */
export type Instrument = z.infer<typeof InstrumentObjectSchema>;

export const InstrumentSchema = InstrumentObjectSchema.transform(
  (instrument): Instrument => ({
    ...instrument,
    sessionCurrency: instrument.sessionCurrency ?? instrument.quoteCurrency,
  }),
);

export const VenueStatusSchema = z.enum(['up', 'degraded', 'down', 'closed']);
export type VenueStatus = z.infer<typeof VenueStatusSchema>;
