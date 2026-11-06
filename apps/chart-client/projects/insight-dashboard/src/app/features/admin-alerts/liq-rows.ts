import { LiqCoinParamsSchema, type LiqCoinParams, type WebLiqAlertRow, type WebLiqCoin } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';
import { marketAlertStatus, utcMinute } from './alert-rows';

/**
 * IB-122 / IB-143 (liq design L2–L4, L12–L13) — the «Large liquidations» section's mapping, pure and spec'd: journal rows as
 * shown, the per-coin form both ways, and the patch that carries only the coins that changed.
 */

/** `$7.4M`, `$300k`, `$950` — the bot's own spelling (delivery/templates/liq-alerts.texts.ts). */
export function usdText(value: number): string {
  const abs = Math.abs(value);
  const unit = (v: number, suffix: string) => `$${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v).toString()}${suffix}`;
  if (abs >= 1e9) return unit(value / 1e9, 'B');
  if (abs >= 1e6) return unit(value / 1e6, 'M');
  if (abs >= 1e3) return unit(value / 1e3, 'k');
  return `$${Math.round(value)}`;
}

export interface LiqRow {
  id: number;
  at: string;
  symbol: string;
  side: StringKey;
  event: StringKey;
  sum: string;
  threshold: string;
  status: { key: StringKey; recipients: number };
}

/**
 * IB-143: a crossing (`alert`) is no longer sent by itself; the message is the market event (`event`), and its
 * close (`event_continuing`) is sent only when it is news — otherwise it is the event's journalled final size.
 * IB-148: an `event` with `news: false` is a small one taken in by a larger same-side event, never sent.
 */
function eventKey(r: WebLiqAlertRow): StringKey {
  switch (r.event) {
    case 'alert': return 'liqAlerts.event.alert';
    case 'continuing': return 'liqAlerts.event.continuing';
    case 'event': return r.news ? 'liqAlerts.event.event' : 'liqAlerts.event.eventMerged';
    case 'event_continuing': return r.news ? 'liqAlerts.event.eventContinuing' : 'liqAlerts.event.eventClosed';
  }
}

export function toLiqRow(r: WebLiqAlertRow): LiqRow {
  return {
    id: r.id,
    at: utcMinute(r.at),
    symbol: r.coins.length > 0 ? r.coins.join(', ') : r.symbol,
    side: r.side === 'long' ? 'liqAlerts.side.long' : 'liqAlerts.side.short',
    event: eventKey(r),
    sum: usdText(r.sumUsd),
    threshold: r.thresholdUsd === null ? '—' : usdText(r.thresholdUsd),
    status: marketAlertStatus(r),
  };
}

/** One coin's row in the form: the switch and the threshold as typed (USD). */
export interface LiqCoinForm {
  symbol: string;
  base: string;
  listed: boolean;
  enabled: boolean;
  threshold: string;
}

export function coinsToForm(coins: readonly WebLiqCoin[]): LiqCoinForm[] {
  return coins.map((c) => ({ symbol: c.symbol, base: c.base, listed: c.listed, enabled: c.enabled, threshold: c.thresholdUsd === null ? '' : String(c.thresholdUsd) }));
}

/** `5 000 000`, `5,000,000`, `5000000` → 5e6; anything else (or ≤ 0) → null. */
export function parseUsd(text: string): number | null {
  const clean = text.replace(/[\s,_]/g, '');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const n = Number(clean);
  return n > 0 ? n : null;
}

/**
 * The coins whose switch or threshold differ from the saved ones, as the PATCH body's `perCoin`.
 * Null when a CHANGED row cannot be saved: a coin switched on needs a threshold (L4), a typed one must parse.
 * An empty object means nothing to save.
 */
export function perCoinPatch(form: readonly LiqCoinForm[], saved: readonly WebLiqCoin[]): Record<string, LiqCoinParams> | null {
  const out: Record<string, LiqCoinParams> = {};
  for (const row of form) {
    const before = saved.find((c) => c.symbol === row.symbol);
    const threshold = row.threshold.trim() === '' ? null : parseUsd(row.threshold);
    const changed = !before || before.enabled !== row.enabled || (threshold ?? null) !== before.thresholdUsd || (row.threshold.trim() !== '' && threshold === null);
    if (!changed) continue;
    if (threshold === null) {
      if (row.enabled || row.threshold.trim() !== '') return null;
      continue; // off and no threshold: nothing to store, the coin stays off (L4)
    }
    const parsed = LiqCoinParamsSchema.safeParse({ enabled: row.enabled, thresholdUsd: threshold });
    if (!parsed.success) return null;
    out[row.symbol] = parsed.data;
  }
  return out;
}
