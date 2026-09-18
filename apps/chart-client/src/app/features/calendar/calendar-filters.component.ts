import { ChangeDetectionStrategy, Component, Input, computed } from '@angular/core';
import { CalendarFiltersStore } from '../../core/state/calendar-filters.store';
import type { EventImpact } from '../../core/contracts/calendar';

const IMPACT_OPTIONS: EventImpact[] = ['low', 'medium', 'high'];

/** §7 — impact ≥ / country multiselect / hide removed, persisted in localStorage (`CalendarFiltersStore`). */
@Component({
  selector: 'app-calendar-filters',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './calendar-filters.component.html',
  styleUrl: './calendar-filters.component.scss',
})
export class CalendarFiltersComponent {
  @Input({ required: true }) countries: string[] = [];

  readonly impactOptions = IMPACT_OPTIONS;
  readonly availableCountries = computed(() => [...this.countries].sort());

  constructor(readonly filters: CalendarFiltersStore) {}

  isCountrySelected(country: string): boolean {
    const selected = this.filters.filters().countries;
    return selected.length === 0 || selected.includes(country);
  }

  onImpactChange(event: Event): void {
    this.filters.setMinImpact((event.target as HTMLSelectElement).value as EventImpact);
  }

  onCountryToggle(country: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const current = this.filters.filters().countries;
    // empty (= all) is the implicit starting state; the first uncheck seeds
    // the explicit list from everything currently on offer, minus this one
    const base = current.length === 0 ? this.countries : current;
    const next = checked ? [...new Set([...base, country])] : base.filter((c) => c !== country);
    this.filters.setCountries(next.length === this.countries.length ? [] : next);
  }

  onHideRemovedChange(event: Event): void {
    this.filters.setHideRemoved((event.target as HTMLInputElement).checked);
  }
}
