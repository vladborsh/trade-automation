import type { EconomicEvent } from '../contracts/calendar';
import { currencyWithFlag } from '../../features/calendar/currency-flag';

/**
 * `🇺🇸 USD · High · CPI m/m (+1)` — one line for a group of events sharing a
 * time, in the same shape as the server's `due:` titles (§5.3) plus the flag
 * (§11.4). Used by the pre-event alert and by filtered toasts.
 */
export function eventGroupLabel(events: readonly EconomicEvent[]): string {
  const [first] = events;
  if (!first) {
    return '';
  }
  const impact = first.impact.charAt(0).toUpperCase() + first.impact.slice(1);
  const more = events.length > 1 ? ` (+${events.length - 1})` : '';
  return `${currencyWithFlag(first.country)} · ${impact} · ${first.title}${more}`;
}
