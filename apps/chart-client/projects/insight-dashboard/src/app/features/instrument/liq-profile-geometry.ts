import { bandOf, type WebLiqProfileBand, type WebLiqProfileResponse, type WebLiqProfileVenueState } from '@trade-automation/contracts';

/**
 * IB-153 — the liquidation profile's shapes, pure: the desktop strip's geometry (`liq-profile.primitive.ts`
 * draws it), the phone histogram's rows, and one band's details for the tooltip and the tap.
 */

/** The strip at the price pane's right edge: a share of the pane, within these bounds. */
export const PROFILE_STRIP = { share: 0.2, minPx: 120, maxPx: 180 } as const;
/** Below this pane width (a phone) the strip is not drawn: the page shows the histogram under the chart. */
export const PROFILE_STRIP_MIN_PANE_PX = 600;

export function stripWidth(paneWidth: number): number {
  if (paneWidth < PROFILE_STRIP_MIN_PANE_PX) return 0;
  return Math.round(Math.min(PROFILE_STRIP.maxPx, Math.max(PROFILE_STRIP.minPx, paneWidth * PROFILE_STRIP.share)));
}

export interface PlacedBand {
  band: number;
  /** y of the band's HIGH edge (smaller y) and of its low edge, from `priceToCoordinate`. */
  yTop: number;
  yBottom: number;
  /** Bar lengths in px: longs grow left of the centre line, shorts right. */
  longPx: number;
  shortPx: number;
}

/**
 * The bands as the strip draws them. Each edge goes through the series' own price → y (`toY`), so a band at
 * price P sits at P on the axis whatever the zoom; bands off the pane are left out, and the bars are
 * scaled to the largest side among the bands on screen, so a quiet view still reads.
 */
export function placeBands(
  answer: WebLiqProfileResponse, toY: (price: number) => number | null, paneHeight: number, halfPx: number,
): PlacedBand[] {
  const placed: Array<Omit<PlacedBand, 'longPx' | 'shortPx'> & { b: WebLiqProfileBand }> = [];
  for (const b of answer.bands) {
    const top = toY((b.band + 1) * answer.step);
    const bottom = toY(b.band * answer.step);
    if (top === null || bottom === null || bottom < 0 || top > paneHeight) continue;
    placed.push({ band: b.band, yTop: top, yBottom: bottom, b });
  }
  const max = placed.reduce((m, p) => Math.max(m, p.b.long.usd, p.b.short.usd), 0);
  const scale = max > 0 ? (halfPx - 2) / max : 0;
  return placed.map(({ b, ...p }) => ({ ...p, longPx: b.long.usd * scale, shortPx: b.short.usd * scale }));
}

/** One band's details: what the tooltip and the phone's tap show. */
export interface BandDetail {
  lo: number;
  hi: number;
  longUsd: number;
  shortUsd: number;
  count: number;
  venues: ReadonlyArray<{ venue: string; longUsd: number; shortUsd: number; count: number }>;
}

/** The band containing `price`; an empty band is a band with nothing in it, not null. */
export function bandDetailAt(answer: WebLiqProfileResponse, price: number): BandDetail {
  return bandDetail(answer, bandOf(price, answer.step));
}

export function bandDetail(answer: WebLiqProfileResponse, band: number): BandDetail {
  const b = answer.bands.find((x) => x.band === band);
  return {
    lo: band * answer.step,
    hi: (band + 1) * answer.step,
    longUsd: b?.long.usd ?? 0,
    shortUsd: b?.short.usd ?? 0,
    count: b ? b.long.count + b.short.count : 0,
    venues: b?.venues ?? [],
  };
}

export interface PhoneRow {
  band: number;
  /** The band's low edge: the label beside the bars. */
  price: number;
  longUsd: number;
  shortUsd: number;
  /** Bar lengths as a share (0–1) of the largest side in the view. */
  longShare: number;
  shortShare: number;
  /** The band the current price is in. */
  current: boolean;
}

/**
 * The phone histogram: every band of the view, high price on top, empty bands included so the price
 * ladder has no holes. At most the view's band count (≤ 40, the grid's rule).
 */
export function phoneRows(answer: WebLiqProfileResponse, lo: number, hi: number, lastPrice: number | null): PhoneRow[] {
  const from = Math.max(bandOf(Math.min(lo, hi), answer.step), answer.coverLo);
  const to = Math.min(bandOf(Math.max(lo, hi), answer.step), answer.coverHi - 1);
  const byBand = new Map(answer.bands.map((b) => [b.band, b]));
  let max = 0;
  for (let i = from; i <= to; i++) {
    const b = byBand.get(i);
    if (b) max = Math.max(max, b.long.usd, b.short.usd);
  }
  const current = lastPrice === null ? null : bandOf(lastPrice, answer.step);
  const rows: PhoneRow[] = [];
  for (let i = to; i >= from; i--) {
    const b = byBand.get(i);
    const longUsd = b?.long.usd ?? 0;
    const shortUsd = b?.short.usd ?? 0;
    rows.push({
      band: i, price: i * answer.step, longUsd, shortUsd,
      longShare: max > 0 ? longUsd / max : 0, shortShare: max > 0 ? shortUsd / max : 0, current: i === current,
    });
  }
  return rows;
}

/** The venues the profile could not see over its window: said as «нет данных», never as $0 (IB-BUG-011). */
export function missingVenues(answer: WebLiqProfileResponse): string[] {
  return answer.venues.filter((v) => v.state === 'not_recorded').map((v) => v.venue);
}

/** A venue's state for the details line: its sums, «нет данных», or nothing (not listed). */
export function venueState(answer: WebLiqProfileResponse, venue: string): WebLiqProfileVenueState | null {
  return answer.venues.find((v) => v.venue === venue)?.state ?? null;
}
