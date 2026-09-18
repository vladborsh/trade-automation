import type { EventImpact } from '../contracts/calendar';

/**
 * architecture/economic-calendar.md §11.2 — THE one named place for the
 * calendar's defaults (filters and the pre-event sound alert). "Reset to
 * defaults" restores exactly this object; nothing else hard-codes a default.
 */
export interface CalendarAlertSettings {
  enabled: boolean;
  leadMinutes: number;
}

export interface CalendarDefaults {
  impacts: readonly EventImpact[];
  countries: readonly string[]; // currency codes as the feed gives them
  hideRemoved: boolean;
  alert: CalendarAlertSettings;
}

export const CALENDAR_DEFAULTS: CalendarDefaults = Object.freeze({
  impacts: Object.freeze(['medium', 'high', 'holiday'] as EventImpact[]),
  countries: Object.freeze(['USD', 'EUR', 'GBP']),
  hideRemoved: false,
  alert: Object.freeze({ enabled: false, leadMinutes: 5 }),
});

/** §11.3 — chip order in the filter bar. */
export const IMPACT_CHOICES: readonly EventImpact[] = ['medium', 'high', 'holiday', 'low', 'unknown'];

/** §11.3 — currencies always offered, whether or not the loaded week has them. */
export const FIXED_CURRENCIES: readonly string[] = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY'];

/** §11.5 — the lead-time choices for the pre-event alert. */
export const ALERT_LEAD_MINUTES: readonly number[] = [1, 2, 5, 10, 15, 30];
