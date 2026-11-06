import { WEB_LIQUIDATION_VENUES, bandOf, venueName, type WebLiqProfileResponse } from '@trade-automation/contracts';
import { formatUsd } from '../liquidations/liquidations.format';
import { dateTime } from '../../shared/time-format';
import { formatAmount } from './amount';
import type { BandDetail } from './liq-profile-geometry';

/**
 * IB-153 — the liquidation profile's words and numbers, pure: one band's details (the desktop tooltip and
 * the phone's tap), the window, what lies outside the visible prices. Times through IB-152's formatter.
 */

export interface VenueLine {
  name: string;
  /** null: the venue was not listening over the window — «нет данных», never $0 (IB-BUG-011). */
  longUsd: string | null;
  shortUsd: string | null;
}

export interface DetailText {
  range: string;
  longUsd: string;
  shortUsd: string;
  count: number;
  venues: VenueLine[];
}

/** A venue the coin is not listed on is left out; one not listening says so; the rest show their sums, $0 included. */
export function detailText(answer: WebLiqProfileResponse, d: BandDetail): DetailText {
  const venues: VenueLine[] = [];
  for (const venue of WEB_LIQUIDATION_VENUES) {
    const state = answer.venues.find((v) => v.venue === venue)?.state ?? 'not_listed';
    if (state === 'not_listed') continue;
    const split = d.venues.find((v) => v.venue === venue);
    venues.push(state === 'not_recorded'
      ? { name: venueName(venue), longUsd: null, shortUsd: null }
      : { name: venueName(venue), longUsd: formatUsd(split?.longUsd ?? 0), shortUsd: formatUsd(split?.shortUsd ?? 0) });
  }
  return {
    range: `${formatAmount(d.lo)} – ${formatAmount(d.hi)}`,
    longUsd: formatUsd(d.longUsd),
    shortUsd: formatUsd(d.shortUsd),
    count: d.count,
    venues,
  };
}

/** The window the profile covers, `03.11 17:53` – `04.11 17:53` in the viewer's zone (IB-152). */
export function windowText(answer: WebLiqProfileResponse): { from: string; to: string } {
  return { from: dateTime(Math.floor(answer.from / 1000)), to: dateTime(Math.floor(answer.to / 1000)) };
}

/**
 * The money liquidated at prices the pane does not show: bands of the cover outside [lo, hi] plus what lay
 * beyond the cover. A side with none is null and not said («ниже $0» is noise); null when neither has any.
 */
export function outsideView(answer: WebLiqProfileResponse, lo: number, hi: number): { above: string | null; below: string | null } | null {
  const top = bandOf(Math.max(lo, hi), answer.step);
  const bottom = bandOf(Math.min(lo, hi), answer.step);
  let above = answer.above.long.usd + answer.above.short.usd;
  let below = answer.below.long.usd + answer.below.short.usd;
  for (const b of answer.bands) {
    if (b.band > top) above += b.long.usd + b.short.usd;
    else if (b.band < bottom) below += b.long.usd + b.short.usd;
  }
  if (above <= 0 && below <= 0) return null;
  return { above: above > 0 ? formatUsd(above) : null, below: below > 0 ? formatUsd(below) : null };
}

/** `BTCUSDT` → `BTC` for the link's words; the link itself carries the full symbol. */
export function coinOf(symbol: string): string {
  return symbol.replace(/(USDT|USDC|USD)$/, '') || symbol;
}
