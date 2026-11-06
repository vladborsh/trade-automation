import {
  CUSTOM_LEVEL_EVENTS, type CustomLevelEvent, type WebCustomLevel, type WebCustomLevelCreate,
} from '@trade-automation/contracts';
import { ApiError } from '@backtest-core/api/api-error';
import type { StringKey } from '../../i18n/keys';
import { atMinute } from './alert-rows';
import { LEVEL_EVENT_KEY, priceText } from './level-rows';

/**
 * IB-128 (alerts design §4 P9) — the «Custom levels» block's mapping, pure and spec'd: the add form's body, the rows
 * as shown with a switch per event, and an error as the words for it. The price takes a DOT for decimals, as the
 * bot's `/level` does: «72,000» is refused rather than read as 72.
 */

export const CUSTOM_EVENT_COLUMNS: ReadonlyArray<{ event: CustomLevelEvent; key: StringKey }> =
  CUSTOM_LEVEL_EVENTS.map((event) => ({ event, key: LEVEL_EVENT_KEY[event] }));

/** «72000», «0.3125» → the number; null for anything else (a comma, a sign, an exponent, zero). */
export function parsePriceText(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export interface CustomLevelForm { symbol: string; price: string; note: string }

/** The POST body, or null while the form cannot be sent (no coin, a bad price). */
export function createBody(form: CustomLevelForm): WebCustomLevelCreate | null {
  const price = parsePriceText(form.price);
  if (form.symbol === '' || price === null) return null;
  const note = form.note.trim();
  return { symbol: form.symbol, price, ...(note === '' ? {} : { note }) };
}

export interface CustomLevelRow {
  id: number;
  symbol: string;
  price: string;
  note: string;
  added: string;
  cells: Array<{ event: CustomLevelEvent; on: boolean }>;
}

export function toCustomLevelRow(l: WebCustomLevel): CustomLevelRow {
  return {
    id: l.id, symbol: l.symbol, price: priceText(l.price), note: l.note ?? '', added: atMinute(l.createdAt),
    cells: CUSTOM_LEVEL_EVENTS.map((event) => ({ event, on: l.events[event] })),
  };
}

/** A failed write as the block says it: the coin at its cap, the coin not listed, or the general failure. */
export function customLevelErrorKey(error: unknown): StringKey {
  if (error instanceof ApiError && error.code === 'TOO_MANY_LEVELS') return 'customLevels.tooMany';
  if (error instanceof ApiError && error.code === 'NOT_FOUND') return 'customLevels.notListed';
  return 'alerts.failed';
}
