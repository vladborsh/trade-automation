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

// IB-006: `crypto-spot` joined the set when the Binance spot collector landed — a spot market is
// not a perp (no funding, no mark price), and the insight bot keys its spot bars on it.
export const AssetClassSchema = z.enum(['crypto-perp', 'crypto-spot', 'index-cfd', 'forex-cfd', 'equity']);
export type AssetClass = z.infer<typeof AssetClassSchema>;

/**
 * backtest-app-system-design.md §6 "Contract, sizing and margin" (D12) — what one unit of `qty`
 * is on the venue, and the venue's limits. `notional = qty × multiplier × price`. Figures and
 * sources: knowledge/venue-contract-specs.md; the values live in instruments.yaml.
 */
export const ContractSpecSchema = z.object({
  /** What `qty` counts, for display: 'BTC', 'contracts', 'EUR'. */
  unit: z.string().min(1),
  /** Quote-currency value of a 1.0 price move per 1 qty. */
  multiplier: z.number().positive(),
  /** The venue's minimum order size, in `unit`. */
  minQty: z.number().positive(),
  /** The venue's size increment; sizes are rounded down to it. */
  qtyStep: z.number().positive(),
  /** The venue's minimum order notional, in the quote currency, where it has one (Binance). */
  minNotional: z.number().positive().optional(),
  /** The leverage cap of the chosen regime (EU/UK retail for Capital.com; Binance's first bracket). */
  maxLeverage: z.number().min(1),
  /** FX only: units per standard lot, for display ("20,000 EUR (0.20 lots)"). */
  displayLot: z.number().positive().optional(),
});
export type ContractSpec = z.infer<typeof ContractSpecSchema>;

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
  /** D12: the contract block. An instrument without one cannot be replayed (INSTRUMENT_NOT_AVAILABLE). */
  contract: ContractSpecSchema.optional(),
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
