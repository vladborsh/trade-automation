import { WebFundingCoinPatchSchema, type WebFundingAlertRow, type WebFundingCoin, type WebFundingCoinPatch } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';
import { marketAlertStatus, utcMinute } from './alert-rows';

/**
 * IB-124 (alerts design §1, F3, F5) — the «Funding» section's mapping, pure and spec'd: journal rows as shown, the per-coin
 * form both ways (a floor typed in PERCENT per 8 h, empty = the shared default), and the patch that carries only the
 * coins that changed.
 */

/** A fraction as a signed percent with 4 decimals, the bot's own spelling: 0.000412 → «+0.0412%». */
export function pctText(fraction: number): string {
  const v = (fraction * 100).toFixed(4);
  return fraction > 0 ? `+${v}%` : fraction < 0 ? `−${v.slice(1)}%` : `${v}%`;
}

/** The floor in percent, trailing zeros dropped: 0.0003 → «0.03». */
export function floorText(fraction: number): string {
  return (fraction * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

export interface FundingRow {
  id: number;
  at: string;
  symbol: string;
  side: StringKey;
  event: StringKey;
  /** «+0.0200% / 4h», the venue's own rate and interval. */
  rate: string;
  per8h: string;
  episode: string;
  status: { key: StringKey; recipients: number };
}

export function toFundingRow(r: WebFundingAlertRow): FundingRow {
  return {
    id: r.id,
    at: utcMinute(r.at),
    symbol: r.symbol,
    side: r.side === 'high' ? 'fundingAlerts.side.high' : 'fundingAlerts.side.low',
    event: r.event === 'enter' ? 'fundingAlerts.event.enter' : 'fundingAlerts.event.flip',
    rate: `${pctText(r.rate)} / ${r.intervalH ?? '?'}h`,
    per8h: pctText(r.ratePer8h),
    episode: r.episodeHours === null ? '—' : `${Math.floor(r.episodeHours)}h`,
    status: marketAlertStatus(r),
  };
}

/** One coin's row: the switch and the floor as typed, in percent per 8 h ('' = the shared default). */
export interface FundingCoinForm {
  symbol: string;
  base: string;
  listed: boolean;
  enabled: boolean;
  floor: string;
}

export function coinsToFundingForm(coins: readonly WebFundingCoin[]): FundingCoinForm[] {
  return coins.map((c) => ({ symbol: c.symbol, base: c.base, listed: c.listed, enabled: c.enabled, floor: c.floorPer8h === null ? '' : floorText(c.floorPer8h) }));
}

/** «0.05», «0,05», «0.05%» → 0.0005 (a fraction); anything else, or ≤ 0, → null. */
export function parsePercent(text: string): number | null {
  const clean = text.trim().replace(',', '.').replace(/%$/, '').trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const n = Number(clean) / 100;
  return n > 0 ? Number(n.toPrecision(12)) : null;
}

/**
 * The coins whose switch or floor differ from the saved ones, as the PATCH body's `perCoin`. An empty floor sends
 * `null` (the shared default). Null when a changed row's floor does not parse or is out of range. `{}` means nothing
 * to save.
 */
export function fundingPerCoinPatch(form: readonly FundingCoinForm[], saved: readonly WebFundingCoin[]): Record<string, WebFundingCoinPatch> | null {
  const out: Record<string, WebFundingCoinPatch> = {};
  for (const row of form) {
    const before = saved.find((c) => c.symbol === row.symbol);
    const typed = row.floor.trim();
    const floor = typed === '' ? null : parsePercent(typed);
    if (typed !== '' && floor === null) return null;
    if (before && before.enabled === row.enabled && before.floorPer8h === floor) continue;
    const parsed = WebFundingCoinPatchSchema.safeParse({ enabled: row.enabled, floorPer8h: floor });
    if (!parsed.success) return null;
    out[row.symbol] = parsed.data;
  }
  return out;
}

/** F5's bounds as typed: whole or decimal hours, > 0 and ≤ 720; else null. */
export function parseHours(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const n = Number(clean);
  return n > 0 && n <= 720 ? n : null;
}
