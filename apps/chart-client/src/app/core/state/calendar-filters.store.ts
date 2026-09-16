import { Injectable, signal } from '@angular/core';
import type { EventImpact } from '../contracts/calendar';

const FILTERS_KEY = 'chart-client:calendar-filters';

export interface CalendarFilters {
  minImpact: EventImpact;
  countries: string[]; // empty = all
  hideRemoved: boolean;
}

const IMPACT_ORDER: EventImpact[] = ['low', 'medium', 'high', 'holiday', 'unknown'];
const DEFAULT_FILTERS: CalendarFilters = { minImpact: 'low', countries: [], hideRemoved: false };

/** §7 `calendar-filters.component.ts` — persisted in localStorage, restored across reload. */
@Injectable({ providedIn: 'root' })
export class CalendarFiltersStore {
  private readonly state = signal<CalendarFilters>(this.readStored());

  readonly filters = this.state.asReadonly();

  setMinImpact(minImpact: EventImpact): void {
    this.update({ minImpact });
  }

  setCountries(countries: string[]): void {
    this.update({ countries });
  }

  setHideRemoved(hideRemoved: boolean): void {
    this.update({ hideRemoved });
  }

  private update(patch: Partial<CalendarFilters>): void {
    const next = { ...this.state(), ...patch };
    this.state.set(next);
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable — filters still work in-memory for this session
    }
  }

  private readStored(): CalendarFilters {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (!raw) {
        return DEFAULT_FILTERS;
      }
      const parsed = JSON.parse(raw) as Partial<CalendarFilters>;
      return {
        minImpact: IMPACT_ORDER.includes(parsed.minImpact as EventImpact) ? (parsed.minImpact as EventImpact) : DEFAULT_FILTERS.minImpact,
        countries: Array.isArray(parsed.countries) ? parsed.countries : DEFAULT_FILTERS.countries,
        hideRemoved: typeof parsed.hideRemoved === 'boolean' ? parsed.hideRemoved : DEFAULT_FILTERS.hideRemoved,
      };
    } catch {
      return DEFAULT_FILTERS;
    }
  }
}

/** Whether an event passes the current filter set — used by the week/day view and unit-tested standalone. */
export function passesFilters(
  event: { impact: EventImpact; country: string; status: string },
  filters: CalendarFilters,
): boolean {
  if (IMPACT_ORDER.indexOf(event.impact) < IMPACT_ORDER.indexOf(filters.minImpact)) {
    return false;
  }
  if (filters.countries.length > 0 && !filters.countries.includes(event.country)) {
    return false;
  }
  if (filters.hideRemoved && event.status === 'removed') {
    return false;
  }
  return true;
}
