/**
 * IB-037 — what the market CARDS need, after §12.1 replaced the charts.
 *
 * The geometry that used to live here (gauge angles, polyline points, stacked bands, the dominance
 * and BTC-share paths — 172 lines) is gone with the charts it served: a sparkline is a chart with
 * its axes hidden, and the ruling is that a reader must not have to read a shape to get a number.
 * What survives is what a card still needs — the palette, the Fear & Greed bands, and a price a
 * reader can read.
 */

/** The palette (AGENTS.md dark-terminal): BTC picked out, the rest a muted ramp. */
export const BTC_COLOUR = '#f0b90b';
export const BAND_COLOURS = ['#26a69a', '#2f81f7', '#8957e5', '#db6d28', '#3fb950', '#6e7681', '#1f6feb', '#a371f7'];

/** The Fear & Greed bands, as alternative.me defines them — value → the class it belongs to. */
export const FEAR_GREED_BANDS = [
  { upTo: 24, key: 'market.fg.extremeFear', colour: '#ef5350' },
  { upTo: 44, key: 'market.fg.fear', colour: '#db6d28' },
  { upTo: 54, key: 'market.fg.neutral', colour: '#8b949e' },
  { upTo: 74, key: 'market.fg.greed', colour: '#3fb950' },
  { upTo: 100, key: 'market.fg.extremeGreed', colour: '#26a69a' },
] as const;

/**
 * The band a value falls in. The venue also sends its own `classification` string, which is what
 * the page SHOWS (§11 keeps the venue's wording); this is only for the colour and for a
 * translated label when a reader wants one, so the two can never contradict each other about the
 * number — both come from the same value.
 */
export function fearGreedBand(value: number): (typeof FEAR_GREED_BANDS)[number] {
  const clamped = Math.max(0, Math.min(100, value));
  return FEAR_GREED_BANDS.find((band) => clamped <= band.upTo) ?? FEAR_GREED_BANDS[FEAR_GREED_BANDS.length - 1];
}

/**
 * A coin price as a reader needs it, not as the venue sent it.
 *
 * CoinGecko returns full float precision — `83289.68745869919`, `0.08828949927571071` — and printing
 * that raw made the table unreadable and implied a precision nobody has. The significant digits move
 * with the magnitude: a four-figure coin needs none after the point, a sub-cent coin needs six, and
 * a fixed number of decimals would wreck one end or the other.
 */
export function coinPrice(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  const decimals = abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
