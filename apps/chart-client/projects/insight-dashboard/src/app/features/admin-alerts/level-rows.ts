import {
  LEVEL_EVENTS, LEVEL_KINDS, levelKindEvents, type LevelEvent, type LevelKind, type WebLevelAlertRow, type WebLevelAlertSettingsPatch,
  type WebLevelCoin,
} from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';
import { utcMinute } from './alert-rows';

/**
 * IB-126 (alerts design §1, P2) — the «Levels» section's mapping, pure and spec'd: journal rows as shown, the per-coin
 * form, the event grid (kind × event, a cell only where the event applies to the kind), and the patch that carries
 * only what changed. The touch band is typed in PERCENT.
 */

export const LEVEL_EVENT_KEY: Record<LevelEvent, StringKey> = {
  breakout_up: 'levelAlerts.event.breakout_up',
  breakout_down: 'levelAlerts.event.breakout_down',
  sweep_above: 'levelAlerts.event.sweep_above',
  sweep_below: 'levelAlerts.event.sweep_below',
  crossunder: 'levelAlerts.event.crossunder',
  crossover: 'levelAlerts.event.crossover',
};

/** A price with up to 8 significant digits, no exponent: 71850 → «71850», 0.312456 → «0.312456». */
export function priceText(p: number): string {
  return String(Number(p.toPrecision(8)));
}

export interface LevelRow {
  id: number;
  at: string;
  symbol: string;
  /** IB-128: `custom` for one of the owner's levels, named by `customLevelId`. */
  kind: LevelKind | 'custom';
  customLevelId: number | null;
  event: StringKey;
  price: string;
  close: string;
  status: { key: StringKey; recipients: number };
}

export function toLevelRow(r: WebLevelAlertRow): LevelRow {
  return {
    id: r.id, at: utcMinute(r.at), symbol: r.symbol, kind: r.kind, customLevelId: r.customLevelId, event: LEVEL_EVENT_KEY[r.event], price: priceText(r.price), close: priceText(r.close),
    status: r.source === 'backfill'
      ? { key: 'alerts.status.history', recipients: 0 }
      : r.late
      ? { key: 'alerts.status.late', recipients: 0 }
      : r.firedAt !== null
      ? { key: 'alerts.status.sent', recipients: r.recipients }
      : { key: 'alerts.status.journalOnly', recipients: 0 },
  };
}

/** One coin's row as edited. */
export interface LevelCoinForm {
  symbol: string;
  listed: boolean;
  enabled: boolean;
  daily: boolean;
  /** P10: 0 = waiting for its one-time seed. */
  stateRows: number;
}

export function coinsToLevelForm(coins: readonly WebLevelCoin[]): LevelCoinForm[] {
  return coins.map((c) => ({ symbol: c.symbol, listed: c.listed, enabled: c.enabled, daily: c.daily, stateRows: c.stateRows }));
}

/** The coins whose switches differ from the server's. */
export function levelPerCoinPatch(form: readonly LevelCoinForm[], coins: readonly WebLevelCoin[]): NonNullable<WebLevelAlertSettingsPatch['perCoin']> {
  const out: NonNullable<WebLevelAlertSettingsPatch['perCoin']> = {};
  for (const f of form) {
    const c = coins.find((x) => x.symbol === f.symbol);
    if (c && (c.enabled !== f.enabled || c.daily !== f.daily)) out[f.symbol] = { enabled: f.enabled, daily: f.daily };
  }
  return out;
}

/** One grid row: a kind and, per event column, its switch, or null where the event does not apply to the kind. */
export interface EventGridRow { kind: LevelKind; cells: Array<{ event: LevelEvent; on: boolean } | null> }

export function eventGrid(events: Partial<Record<LevelKind, Partial<Record<LevelEvent, boolean>>>>): EventGridRow[] {
  return LEVEL_KINDS.map((kind) => ({
    kind,
    cells: LEVEL_EVENTS.map((event) => (levelKindEvents(kind).includes(event) ? { event, on: events[kind]?.[event] ?? true } : null)),
  }));
}

/** The (kind, event) switches that differ from the server's, as the patch's `events`. */
export function eventsPatch(grid: readonly EventGridRow[], server: Partial<Record<LevelKind, Partial<Record<LevelEvent, boolean>>>>): NonNullable<WebLevelAlertSettingsPatch['events']> {
  const out: NonNullable<WebLevelAlertSettingsPatch['events']> = {};
  for (const row of grid) {
    for (const cell of row.cells) {
      if (!cell || cell.on === (server[row.kind]?.[cell.event] ?? true)) continue;
      out[row.kind] = { ...(out[row.kind] ?? {}), [cell.event]: cell.on };
    }
  }
  return out;
}

/** The touch band typed in percent («0.1») as a fraction; null when not a positive number up to 5 %. */
export function parseBandPct(text: string): number | null {
  const v = Number(text.trim().replace(',', '.'));
  if (text.trim() === '' || !Number.isFinite(v) || v <= 0 || v > 5) return null;
  return Number((v / 100).toPrecision(10));
}

/** 0.001 → «0.1». */
export function bandText(fraction: number): string {
  return String(Number((fraction * 100).toPrecision(10)));
}
