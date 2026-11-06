import {
  LEVEL_EVENT_DIRECTION, customLevelDedupeKey, mutedDedupeKey, customLevelEventOn, isCustomLevelEvent, type CustomLevelAlertDetails, type LevelBar,
} from '@trade-automation/contracts';
import { barCloseMs } from '../../delivery/templates/level-alerts.texts';
import { levelStepFrom } from './level-step';
import type { CustomLevel } from './pg/custom-levels.repo';
import type { NewLevelAlert } from './pg/level-alerts.repo';

const DAY_MS = 86_400_000;

/**
 * IB-128 (design §4 P9) — one 15m bar against a coin's custom levels, as a pure function: the alerts it produces,
 * ready for the loop's one-transaction commit next to the built-in levels'.
 *
 * - Stepped **as an open** (`levelStepFrom('open', …)`, no P10 state): breakout up/down, sweep above/below.
 * - A level counts from the first bar that closes after it was added; a catch-up after downtime does not replay a new
 *   level over bars that closed before anyone drew it.
 * - The level's own switches decide which events are SENT; absent = on. IB-151: an event switched off is journalled
 *   all the same, `mutedBy: 'custom_event'`, under its own once-key (`…:muted`).
 * - **Once per (level, event, UTC day)**: the key carries the UTC midnight of the bar's open, so a level broken today
 *   can speak again tomorrow (P9: "without a bound, a level that is broken once would never speak again").
 * - No touch or random controls: those are the baseline of the built-in kinds (P7), and a level the owner draws by
 *   hand is no sample of anything.
 */
export function customLevelAlerts(symbol: string, levels: readonly CustomLevel[], bar: LevelBar, prevClose: number, late: boolean): NewLevelAlert[] {
  const closeMs = barCloseMs(bar.openMs);
  const dayStartMs = Math.floor(bar.openMs / DAY_MS) * DAY_MS;
  const out: NewLevelAlert[] = [];
  for (const level of levels) {
    if (level.symbol !== symbol || level.createdAtMs >= closeMs) continue;
    for (const event of levelStepFrom('open', level.price, bar, prevClose, null, 0).events) {
      if (!isCustomLevelEvent(event)) continue;
      const details: CustomLevelAlertDetails = { kind: 'custom', levelId: level.id, price: level.price, note: level.note, dayStartMs, bar, prevClose };
      const dedupeKey = customLevelDedupeKey(symbol, level.id, dayStartMs, event);
      out.push({
        event, symbol, direction: LEVEL_EVENT_DIRECTION[event], atMs: bar.openMs, late, details,
        ...(customLevelEventOn(level.events, event) ? { dedupeKey } : { dedupeKey: mutedDedupeKey(dedupeKey), mutedBy: 'custom_event' as const }),
      });
    }
  }
  return out;
}
