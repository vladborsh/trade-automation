import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CalendarFiltersStore } from '../../core/state/calendar-filters.store';
import { EventAlarmService } from '../../core/state/event-alarm.service';
import { ALERT_LEAD_MINUTES, CALENDAR_DEFAULTS, IMPACT_CHOICES } from '../../core/state/calendar-settings.defaults';
import type { EventImpact } from '../../core/contracts/calendar';
import { currencyFlag } from './currency-flag';
import { currencyOptions } from './currency-options';

/**
 * §11.3 — the calendar settings surface: impact chips, currencies (fixed list
 * plus any code seen this week), hide-removed, the sound alert and "Reset to
 * defaults". Every change persists immediately (`CalendarFiltersStore`).
 */
@Component({
  selector: 'app-calendar-filters',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './calendar-filters.component.html',
  styleUrl: './calendar-filters.component.scss',
})
export class CalendarFiltersComponent {
  /** Currency codes present in the loaded week. */
  readonly countries = input<string[]>([]);

  readonly impactChoices = IMPACT_CHOICES;
  readonly leadChoices = ALERT_LEAD_MINUTES;
  readonly currencyFlag = currencyFlag;
  readonly currencies = computed(() => currencyOptions(this.countries(), this.store.filters().countries));

  constructor(
    readonly store: CalendarFiltersStore,
    readonly alarm: EventAlarmService,
  ) {}

  isImpactOn(impact: EventImpact): boolean {
    return this.store.filters().impacts.includes(impact);
  }

  isCountrySelected(country: string): boolean {
    return this.store.filters().countries.includes(country);
  }

  selectAllCountries(): void {
    this.store.setCountries(this.currencies());
  }

  selectNoCountries(): void {
    this.store.setCountries([]);
  }

  selectDefaultCountries(): void {
    this.store.setCountries([...CALENDAR_DEFAULTS.countries]);
  }

  onHideRemovedChange(event: Event): void {
    this.store.setHideRemoved((event.target as HTMLInputElement).checked);
  }

  onSoundToggle(event: Event): void {
    this.alarm.setEnabled((event.target as HTMLInputElement).checked);
  }

  onLeadChange(event: Event): void {
    this.store.setLeadMinutes(Number((event.target as HTMLSelectElement).value));
  }
}
