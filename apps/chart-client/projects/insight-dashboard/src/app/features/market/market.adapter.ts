import { FEAR_GREED_ZONES, fearGreedZone, type FearGreedBand } from '@trade-automation/contracts';

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

/** The word and colour of each zone. The EDGES are not here: they are the contract's (IB-102). */
export const FEAR_GREED_STYLE = {
  extreme_fear: { key: 'market.fg.extremeFear', colour: '#ef5350' },
  fear: { key: 'market.fg.fear', colour: '#db6d28' },
  neutral: { key: 'market.fg.neutral', colour: '#8b949e' },
  greed: { key: 'market.fg.greed', colour: '#3fb950' },
  extreme_greed: { key: 'market.fg.extremeGreed', colour: '#26a69a' },
} as const satisfies Record<FearGreedBand, { key: string; colour: string }>;

/**
 * The Fear & Greed bands, as alternative.me defines them — value → the class it belongs to. IB-102:
 * the edges come from the contract's `FEAR_GREED_ZONES`, the same table the bot's `fngBand` (KPI
 * strip, R7) reads. This file had its own copy with neutral ≤ 54 and greed ≤ 74 (IB-037), so 55 and
 * 75 were worded one zone higher here than in the bot's statements.
 */
export const FEAR_GREED_BANDS = FEAR_GREED_ZONES.map((zone) => ({ upTo: zone.upTo, band: zone.band, ...FEAR_GREED_STYLE[zone.band] }));

/**
 * The band a value falls in. The venue also sends its own `classification` string, which is what
 * the page SHOWS (§11 keeps the venue's wording); this is only for the colour and for a
 * translated label when a reader wants one, so the two can never contradict each other about the
 * number — both come from the same value.
 */
export function fearGreedBand(value: number): (typeof FEAR_GREED_BANDS)[number] {
  const band = fearGreedZone(value);
  return FEAR_GREED_BANDS.find((b) => b.band === band) as (typeof FEAR_GREED_BANDS)[number];
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
