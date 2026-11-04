import type { StringKey } from '../../i18n/keys';
import { formatRatio } from './liquidations.format';

/**
 * IB-108 (market-page design §7.6) — «Где ликвидируют»'s verdict column: which side of a coin was
 * liquidated MORE in the period, and by how much — the bigger side over the smaller («лонги ×2.2»,
 * «шорты ×3.3»). Under `SIDE_VERDICT_MIN` (1.5×) the two are «поровну».
 *
 * A side with nothing against one with something is no finite ratio: it says the side alone
 * («только лонги»), never «×∞» or a made-up number. Nothing on both sides: no verdict (the row is
 * not drawn anyway — `whereRows` leaves quiet coins out).
 *
 * This is NOT IB-089's server verdict (`perCoin[].verdict`, the coin's total against ITS OWN norm):
 * that one stays, beside this, as «×N от нормы» whenever the server has a norm.
 */
export const SIDE_VERDICT_MIN = 1.5;

export interface SideVerdict {
  key: StringKey;
  params: { ratio: string };
  side: 'long' | 'short' | 'even';
}

export function sideVerdict(long: number, short: number): SideVerdict | null {
  const l = Math.max(0, long);
  const s = Math.max(0, short);
  if (l === 0 && s === 0) return null;
  if (s === 0) return { key: 'liq.side.onlyLongs', params: { ratio: '' }, side: 'long' };
  if (l === 0) return { key: 'liq.side.onlyShorts', params: { ratio: '' }, side: 'short' };
  const ratio = Math.max(l, s) / Math.min(l, s);
  if (ratio < SIDE_VERDICT_MIN) return { key: 'liq.side.even', params: { ratio: '' }, side: 'even' };
  return l > s
    ? { key: 'liq.side.moreLongs', params: { ratio: formatRatio(ratio) as string }, side: 'long' }
    : { key: 'liq.side.moreShorts', params: { ratio: formatRatio(ratio) as string }, side: 'short' };
}
