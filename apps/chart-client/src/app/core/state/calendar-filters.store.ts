import { Injectable, signal } from '@angular/core';
import type { EventImpact } from '../contracts/calendar';
import { ALERT_LEAD_MINUTES, CALENDAR_DEFAULTS, IMPACT_CHOICES, type CalendarAlertSettings } from './calendar-settings.defaults';

/**
 * §11.2 — v2: impact is a set and countries an explicit list. The v1 key is
 * read-and-ignored (then removed), not migrated: its value is almost always
 * the old "everything" default, and carrying it over would silently keep
 * hiding the new defaults.
 */
export const FILTERS_KEY = 'chart-client:calendar-filters:v2';
export const LEGACY_FILTERS_KEY = 'chart-client:calendar-filters';
export const ALERT_SETTINGS_KEY = 'chart-client:calendar-alert-settings';

export interface CalendarFilters {
  impacts: EventImpact[];
  countries: string[]; // explicit list; empty = none
  hideRemoved: boolean;
}

export function defaultFilters(): CalendarFilters {
  return {
    impacts: [...CALENDAR_DEFAULTS.impacts],
    countries: [...CALENDAR_DEFAULTS.countries],
    hideRemoved: CALENDAR_DEFAULTS.hideRemoved,
  };
}

export function defaultAlertSettings(): CalendarAlertSettings {
  return { ...CALENDAR_DEFAULTS.alert };
}

/**
 * §11.3 — the calendar settings surface: filters (what you see, and what
 * toasts and alerts fire for) plus the sound-alert settings. Every change
 * persists immediately.
 */
@Injectable({ providedIn: 'root' })
export class CalendarFiltersStore {
  private readonly state = signal<CalendarFilters>(readStoredFilters());
  private readonly alertState = signal<CalendarAlertSettings>(readStoredAlertSettings());

  readonly filters = this.state.asReadonly();
  readonly alert = this.alertState.asReadonly();

  toggleImpact(impact: EventImpact): void {
    const current = this.state().impacts;
    this.update({ impacts: current.includes(impact) ? current.filter((i) => i !== impact) : [...current, impact] });
  }

  setCountries(countries: string[]): void {
    this.update({ countries: [...new Set(countries)] });
  }

  toggleCountry(country: string): void {
    const current = this.state().countries;
    this.setCountries(current.includes(country) ? current.filter((c) => c !== country) : [...current, country]);
  }

  setHideRemoved(hideRemoved: boolean): void {
    this.update({ hideRemoved });
  }

  setAlertEnabled(enabled: boolean): void {
    this.updateAlert({ enabled });
  }

  setLeadMinutes(leadMinutes: number): void {
    if (ALERT_LEAD_MINUTES.includes(leadMinutes)) {
      this.updateAlert({ leadMinutes });
    }
  }

  /** §11.3 "Reset to defaults" — filters and alert settings both. */
  resetToDefaults(): void {
    this.state.set(defaultFilters());
    this.alertState.set(defaultAlertSettings());
    write(FILTERS_KEY, this.state());
    write(ALERT_SETTINGS_KEY, this.alertState());
  }

  private update(patch: Partial<CalendarFilters>): void {
    this.state.set({ ...this.state(), ...patch });
    write(FILTERS_KEY, this.state());
  }

  private updateAlert(patch: Partial<CalendarAlertSettings>): void {
    this.alertState.set({ ...this.alertState(), ...patch });
    write(ALERT_SETTINGS_KEY, this.alertState());
  }
}

/** Whether an event passes the current filter set — the week view, toasts and the sound alert all use it. */
export function passesFilters(
  event: { impact: EventImpact; country: string; status: string },
  filters: CalendarFilters,
): boolean {
  if (!filters.impacts.includes(event.impact)) {
    return false;
  }
  // 'All' (e.g. a G20 summit) is about every currency: it passes whenever any currency is selected
  const countryPasses = event.country === 'All' ? filters.countries.length > 0 : filters.countries.includes(event.country);
  if (!countryPasses) {
    return false;
  }
  if (filters.hideRemoved && event.status === 'removed') {
    return false;
  }
  return true;
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage unavailable — settings still work in-memory for this session
  }
}

function readJson(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readStoredFilters(): CalendarFilters {
  try {
    localStorage.removeItem(LEGACY_FILTERS_KEY);
  } catch {
    // nothing to discard
  }
  const parsed = readJson(FILTERS_KEY);
  const defaults = defaultFilters();
  if (!parsed) {
    return defaults;
  }
  const impacts = Array.isArray(parsed['impacts'])
    ? IMPACT_CHOICES.filter((i) => (parsed['impacts'] as unknown[]).includes(i))
    : defaults.impacts;
  const countries = Array.isArray(parsed['countries'])
    ? (parsed['countries'] as unknown[]).filter((c): c is string => typeof c === 'string')
    : defaults.countries;
  const hideRemoved = typeof parsed['hideRemoved'] === 'boolean' ? parsed['hideRemoved'] : defaults.hideRemoved;
  return { impacts, countries, hideRemoved };
}

function readStoredAlertSettings(): CalendarAlertSettings {
  const parsed = readJson(ALERT_SETTINGS_KEY);
  const defaults = defaultAlertSettings();
  if (!parsed) {
    return defaults;
  }
  return {
    enabled: typeof parsed['enabled'] === 'boolean' ? parsed['enabled'] : defaults.enabled,
    leadMinutes: ALERT_LEAD_MINUTES.includes(parsed['leadMinutes'] as number) ? (parsed['leadMinutes'] as number) : defaults.leadMinutes,
  };
}
