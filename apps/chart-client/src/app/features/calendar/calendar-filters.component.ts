import { ChangeDetectionStrategy, Component, Input, computed } from '@angular/core';
import { CalendarFiltersStore } from '../../core/state/calendar-filters.store';
import type { EventImpact } from '../../core/contracts/calendar';

const IMPACT_OPTIONS: EventImpact[] = ['low', 'medium', 'high'];

/** §7 — impact ≥ / country multiselect / hide removed, persisted in localStorage (`CalendarFiltersStore`). */
@Component({
  selector: 'app-calendar-filters',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="filters">
      <label class="field">
        Impact ≥
        <select (change)="onImpactChange($event)">
          @for (impact of impactOptions; track impact) {
            <option [value]="impact" [selected]="impact === filters.filters().minImpact">{{ impact }}</option>
          }
        </select>
      </label>

      <div class="field countries">
        Countries
        <div class="country-list">
          @for (country of availableCountries(); track country) {
            <label class="country-item">
              <input type="checkbox" [checked]="isCountrySelected(country)" (change)="onCountryToggle(country, $event)" />
              {{ country }}
            </label>
          }
        </div>
      </div>

      <label class="field">
        <input type="checkbox" [checked]="filters.filters().hideRemoved" (change)="onHideRemovedChange($event)" />
        Hide removed
      </label>
    </div>
  `,
  styles: [
    `
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        align-items: flex-start;
        padding: 6px 12px;
        border-bottom: 1px solid #30363d;
        font-size: 12px;
        color: #8b949e;
      }
      .field {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      select {
        background: #0d1117;
        color: #c9d1d9;
        border: 1px solid #30363d;
      }
      .country-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .country-item {
        display: inline-flex;
        gap: 4px;
        align-items: center;
      }
    `,
  ],
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
