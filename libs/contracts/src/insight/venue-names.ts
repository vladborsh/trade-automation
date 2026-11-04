/**
 * IB-BUG-032 — how a venue or data provider is SPELLED wherever a member reads its name: a
 * statement's basis line («за 24ч · Binance+Bybit+OKX · …»), a line that could not read its
 * sources, and the credit under a block («Данные: Deribit · OKX · DefiLlama · Coinbase»).
 *
 * One map, read by the bot (the credit names it sends) and by the dashboard (the keys it words),
 * so the two lines under one block can no longer spell the same source two ways («defillama» in
 * the basis, «DefiLlama» in the credit, 2026-11-04). A venue name is an identifier: it is not
 * translated (i18n rule), only spelled as its owner spells it.
 *
 * The keys are what the server puts in `WebInsightBasis.venues` and `WebInsightSource`, and what
 * the liquidation tape stores in its `venue` column. Adding a venue there means adding it here:
 * `test/venue-names.spec.ts` fails otherwise.
 */
export const WEB_VENUE_NAMES = {
  binance: 'Binance',
  bybit: 'Bybit',
  okx: 'OKX',
  deribit: 'Deribit',
  defillama: 'DefiLlama',
  coinbase: 'Coinbase',
} as const;
export type WebVenueKey = keyof typeof WEB_VENUE_NAMES;

/**
 * A key's display name. A key this map does not know is returned as it came: an identifier shown
 * raw is less wrong than a blank or a guess, and the spec above is where an unknown key is caught.
 */
export function venueName(key: string): string {
  return Object.prototype.hasOwnProperty.call(WEB_VENUE_NAMES, key) ? WEB_VENUE_NAMES[key as WebVenueKey] : key;
}
