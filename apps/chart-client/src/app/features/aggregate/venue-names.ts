import type { InstrumentId, Venue } from '@trade-automation/contracts';

/** architecture/aggregate-oi.md §1 — how a venue is named in the chip, the tooltip and the seam markers. */
export const VENUE_DISPLAY_NAMES: Readonly<Record<Venue, string>> = {
  binance: 'Binance',
  bybit: 'Bybit',
  hyperliquid: 'Hyperliquid',
  capitalcom: 'Capital.com',
};

export function venueDisplayName(venue: string): string {
  return (VENUE_DISPLAY_NAMES as Record<string, string>)[venue] ?? venue;
}

/** An aggregate member id (`<venue>:<symbol>`, InstrumentId shape) → its venue's display name. */
export function memberDisplayName(member: InstrumentId): string {
  const colon = member.indexOf(':');
  return venueDisplayName(colon < 0 ? member : member.slice(0, colon));
}
