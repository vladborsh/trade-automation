import { WEB_MAX_1M_RANGE_DAYS, type WebTimeframe } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';

/**
 * IB-031 — the instrument page's range and timeframe choices
 * (architecture/insight-bot-web-dashboard.md §2).
 *
 * Pure and specced, per AGENTS.md, because the interesting part is not the arithmetic: it is
 * that **the page must never offer a combination the server will refuse.** The server rejects a
 * 1m range over 90 days with `RANGE_TOO_WIDE`; a picker that lets someone choose "1 year" and
 * "1m" and then shows them an error is a worse page than one that quietly coarsens the frame.
 */

export type RangeKey = '1d' | '3d' | '1w' | '1m' | '3m' | '1y';

export interface RangePreset {
  key: RangeKey;
  /**
   * The i18n key, not the text (§11, IB-BUG-004). The label lives in `i18n/{ru,en}.ts`, so this
   * module stays pure and the page renders it in the member's language.
   */
  labelKey: StringKey;
  days: number;
}

export const RANGE_PRESETS: readonly RangePreset[] = [
  { key: '1d', labelKey: 'range.1d', days: 1 },
  { key: '3d', labelKey: 'range.3d', days: 3 },
  { key: '1w', labelKey: 'range.1w', days: 7 },
  { key: '1m', labelKey: 'range.1m', days: 30 },
  { key: '3m', labelKey: 'range.3m', days: 90 },
  { key: '1y', labelKey: 'range.1y', days: 365 },
];

export const TIMEFRAMES: readonly WebTimeframe[] = ['1m', '15m', '1h', '4h', '1d'];

const DAY_MS = 86_400_000;

export function rangeOf(preset: RangePreset, nowMs: number): { fromMs: number; toMs: number } {
  return { fromMs: nowMs - preset.days * DAY_MS, toMs: nowMs };
}

/** True when the server would refuse this pair outright. */
export function isRefused(preset: RangePreset, tf: WebTimeframe): boolean {
  return tf === '1m' && preset.days > WEB_MAX_1M_RANGE_DAYS;
}

/**
 * The timeframe to actually request: the chosen one, or the finest the server will serve for
 * this range. Coarsening silently is the right call *only because the page says it did* — the
 * caller shows `coarsenedTo` next to the switch.
 */
export function effectiveTimeframe(preset: RangePreset, tf: WebTimeframe): WebTimeframe {
  return isRefused(preset, tf) ? '15m' : tf;
}

/** The timeframes that may be offered for a range, so the switch disables the rest. */
export function allowedTimeframes(preset: RangePreset): WebTimeframe[] {
  return TIMEFRAMES.filter((tf) => !isRefused(preset, tf));
}

/**
 * The liquidation bucket that suits a range: fine enough to see a cascade, coarse enough that a
 * quarter is not 129,600 bars. Independent of the candle timeframe, because a cascade is worth
 * seeing at 1m even when price is drawn at 1h.
 */
export function bucketFor(preset: RangePreset): '1m' | '15m' | '1h' {
  if (preset.days <= 3) return '1m';
  if (preset.days <= 30) return '15m';
  return '1h';
}

export function findPreset(key: string): RangePreset | null {
  return RANGE_PRESETS.find((p) => p.key === key) ?? null;
}
