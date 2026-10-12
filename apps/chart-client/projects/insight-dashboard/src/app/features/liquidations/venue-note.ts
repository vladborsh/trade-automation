import type { WebLiquidationsOverviewResponse } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';

/**
 * IB-038 §12.4 — the honesty line, shared by the card, the table and the feed.
 *
 * In its own file because all three show it and none of them owns it: §12.4 says *every* card and
 * table says so while a venue's liquidations are not collected, and a rule implemented three
 * times is a rule that will soon be implemented twice.
 */
export interface VenueNote {
  key: StringKey;
  params: Record<string, string>;
}

/**
 * `null` when every venue we collect from is reporting — there is nothing to warn about and a
 * permanent banner would be trained away. Otherwise the missing venues, named.
 */
export function venueNote(venues: WebLiquidationsOverviewResponse['venues']): VenueNote | null {
  if (venues.missing.length === 0) return null;
  return { key: 'liq.venues.missing', params: { venues: venues.missing.join(', ') } };
}

/** The venues the figures DID come from, so "all venues" is never implied by silence. */
export function presentNote(venues: WebLiquidationsOverviewResponse['venues']): VenueNote | null {
  if (venues.present.length === 0) return null;
  return { key: 'liq.venues.present', params: { venues: venues.present.join(', ') } };
}
