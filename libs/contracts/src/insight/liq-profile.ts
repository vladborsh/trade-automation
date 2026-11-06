import { z } from 'zod';
import { WEB_LIQUIDATION_VENUES } from './liquidations-large';

/**
 * IB-153 — the instrument page's liquidation profile by price: every liquidation of the coin in the
 * visible time range, all venues, summed into price bands (a volume profile for liquidations).
 *
 * **The bands are cut on the server, in SQL** (`floor(price / step)`), so the answer is a few
 * hundred grouped rows however many prints the range holds; the browser never sees the rows and so
 * cannot band a top-N by mistake (the old table was the 50 largest). The grid arithmetic is here,
 * shared, because both ends need it: the server to bin, the client to know when the view has left
 * what it fetched.
 *
 * The grid: a "nice" step (1, 2, 2.5 or 5 × 10ⁿ) giving 20 < bands ≤ 40 across the VISIBLE span, and
 * a cover padded by half a span on each side and snapped to whole chunks of `COVER_CHUNK` bands, so
 * a vertical scroll inside it needs no new read and nearby views share one cache key. Band `i` is
 * `[i·step, (i+1)·step)`: a print exactly on an edge belongs to the band ABOVE it.
 */

/** At most this many bands across the visible span; the nice-step ladder keeps it above half of it. */
export const LIQ_PROFILE_MAX_BANDS = 40;
/** The cover is snapped to multiples of this many bands, so small moves keep the same cover. */
export const LIQ_PROFILE_COVER_CHUNK = 10;
const MANTISSAS = [1, 2, 2.5, 5] as const;

export interface LiqProfileGrid {
  step: number;
  /** First band index of the cover (inclusive); band i spans [i·step, (i+1)·step). */
  coverLo: number;
  /** Last band index of the cover, exclusive. */
  coverHi: number;
}

/**
 * The smallest nice step with at most `LIQ_PROFILE_MAX_BANDS` bands over `[lo, hi]`. A span that is
 * empty or not finite (one price, a flat chart) takes 1 % of the price as its span, so a
 * single print still gets a band of a sensible width; a price of 0 takes a span of 1.
 */
export function profileStep(lo: number, hi: number): number {
  let span = Math.abs(hi - lo);
  if (!Number.isFinite(span) || span <= 0) {
    const ref = Math.abs(Number.isFinite(hi) ? hi : Number.isFinite(lo) ? lo : 0);
    span = ref > 0 ? ref * 0.01 : 1;
  }
  const wanted = span / LIQ_PROFILE_MAX_BANDS;
  let exp = Math.floor(Math.log10(wanted));
  for (;;) {
    for (const m of MANTISSAS) {
      const step = scaled(m, exp);
      if (step >= wanted * (1 - 1e-12)) return step;
    }
    exp += 1;
  }
}

/** m × 10^exp built so that its shortest decimal text is the clean one (2.5e-5, not 2.5000000000000004e-5). */
function scaled(m: number, exp: number): number {
  return exp >= 0 ? m * 10 ** exp : m / 10 ** -exp;
}

/**
 * The band a price falls in. Floating division misplaces exact edges (0.3 / 0.1 = 2.999…), so a
 * quotient within 1e-9 of an integer is that integer: an edge print goes to the band above, as in
 * SQL's exact `numeric` floor.
 */
export function bandOf(price: number, step: number): number {
  const q = price / step;
  const r = Math.round(q);
  return Math.abs(q - r) <= 1e-9 * Math.max(1, Math.abs(q)) ? r : Math.floor(q);
}

/** The grid for a visible price span: the step for it, and a cover half a span wider on each side. */
export function profileGrid(lo: number, hi: number): LiqProfileGrid {
  const step = profileStep(lo, hi);
  const low = Math.min(lo, hi);
  const high = Math.max(lo, hi);
  const pad = Math.max(high - low, step) / 2;
  const chunk = LIQ_PROFILE_COVER_CHUNK;
  const coverLo = Math.floor(bandOf(low - pad, step) / chunk) * chunk;
  const coverHi = Math.ceil((bandOf(high + pad, step) + 1) / chunk) * chunk;
  return { step, coverLo, coverHi };
}

/**
 * True when what was fetched for `grid` still serves the view `[lo, hi]`: the same step, and the
 * view inside the cover. Anything else is a new read (after the client's debounce).
 */
export function gridServes(grid: LiqProfileGrid, lo: number, hi: number): boolean {
  const want = profileStep(lo, hi);
  if (Math.abs(want - grid.step) > grid.step * 1e-9) return false;
  return bandOf(Math.min(lo, hi), grid.step) >= grid.coverLo && bandOf(Math.max(lo, hi), grid.step) < grid.coverHi;
}

type LiqSide = 'long' | 'short';

/** One SQL group: a band, a side, a venue. */
export interface LiqProfileGroup {
  band: number;
  side: LiqSide;
  venue: string;
  usd: number;
  count: number;
}

/** A raw print, for `groupRows` (the in-memory twin of the SQL grouping, used as its oracle). */
export interface LiqProfilePrint {
  price: number;
  side: LiqSide;
  venue: string;
  usd: number;
}

/** What SQL does, in memory: every print into (band, side, venue). The specs' reference. */
export function groupRows(rows: readonly LiqProfilePrint[], step: number): LiqProfileGroup[] {
  const groups = new Map<string, LiqProfileGroup>();
  for (const r of rows) {
    const band = bandOf(r.price, step);
    const key = `${band}|${r.side}|${r.venue}`;
    const g = groups.get(key) ?? { band, side: r.side, venue: r.venue, usd: 0, count: 0 };
    g.usd += r.usd;
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()];
}

const SideSumSchema = z.object({ usd: z.number().nonnegative(), count: z.number().int().nonnegative() });
export type LiqSideSum = z.infer<typeof SideSumSchema>;

export const WebLiqProfileVenueSplitSchema = z.object({
  venue: z.string(),
  longUsd: z.number().nonnegative(),
  shortUsd: z.number().nonnegative(),
  count: z.number().int().nonnegative(),
});
export type WebLiqProfileVenueSplit = z.infer<typeof WebLiqProfileVenueSplitSchema>;

export const WebLiqProfileBandSchema = z.object({
  /** Band index: the band is [band·step, (band+1)·step). */
  band: z.number().int(),
  long: SideSumSchema,
  short: SideSumSchema,
  /** Per venue, venues with no print in the band left out; sorted by venue. */
  venues: z.array(WebLiqProfileVenueSplitSchema),
});
export type WebLiqProfileBand = z.infer<typeof WebLiqProfileBandSchema>;

const OutsideSchema = z.object({ long: SideSumSchema, short: SideSumSchema });
export type WebLiqProfileOutside = z.infer<typeof OutsideSchema>;

/**
 * IB-153, IB-BUG-011 — a venue's state over the REQUESTED window, by WD-009's three states plus one:
 * `not_listed` when the coin has no symbol on that venue. `not_recorded` is "no data", never $0.
 */
export const WebLiqProfileVenueStateSchema = z.enum(['recorded', 'no_events', 'not_recorded', 'not_listed']);
export type WebLiqProfileVenueState = z.infer<typeof WebLiqProfileVenueStateSchema>;

export const WebLiqProfileResponseSchema = z.object({
  symbol: z.string(),
  /** The window read, ms, [from, to). */
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  step: z.number().positive(),
  coverLo: z.number().int(),
  coverHi: z.number().int(),
  /** Only the bands with a print in them, ascending by `band`. */
  bands: z.array(WebLiqProfileBandSchema),
  /** Prints priced above / below the cover: counted, not dropped. */
  above: OutsideSchema,
  below: OutsideSchema,
  venues: z.array(z.object({ venue: z.enum(WEB_LIQUIDATION_VENUES), state: WebLiqProfileVenueStateSchema })),
  /** §12.2: Binance publishes at most one forceOrder per second per symbol. */
  undercounted: z.boolean(),
});
export type WebLiqProfileResponse = z.infer<typeof WebLiqProfileResponseSchema>;

const zero = (): LiqSideSum => ({ usd: 0, count: 0 });

/**
 * The SQL groups folded into the answer's bands: inside the cover by band, sorted ascending, each with
 * its venue split; outside it into `above` / `below`. Nothing is dropped: the totals of `bands`,
 * `above` and `below` are the totals of the groups.
 */
export function foldProfile(
  groups: readonly LiqProfileGroup[], grid: LiqProfileGrid,
): Pick<WebLiqProfileResponse, 'bands' | 'above' | 'below'> {
  const above = { long: zero(), short: zero() };
  const below = { long: zero(), short: zero() };
  const bands = new Map<number, { band: WebLiqProfileBand; venues: Map<string, WebLiqProfileVenueSplit> }>();
  for (const g of groups) {
    if (g.band < grid.coverLo || g.band >= grid.coverHi) {
      const out = (g.band < grid.coverLo ? below : above)[g.side];
      out.usd += g.usd;
      out.count += g.count;
      continue;
    }
    let entry = bands.get(g.band);
    if (!entry) {
      entry = { band: { band: g.band, long: zero(), short: zero(), venues: [] }, venues: new Map() };
      bands.set(g.band, entry);
    }
    entry.band[g.side].usd += g.usd;
    entry.band[g.side].count += g.count;
    const split = entry.venues.get(g.venue) ?? { venue: g.venue, longUsd: 0, shortUsd: 0, count: 0 };
    if (g.side === 'long') split.longUsd += g.usd;
    else split.shortUsd += g.usd;
    split.count += g.count;
    entry.venues.set(g.venue, split);
  }
  return {
    bands: [...bands.values()]
      .sort((a, b) => a.band.band - b.band.band)
      .map(({ band, venues }) => ({ ...band, venues: [...venues.values()].sort((a, b) => a.venue.localeCompare(b.venue)) })),
    above,
    below,
  };
}
