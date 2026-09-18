import { CalendarFiltersStore, FILTERS_KEY, LEGACY_FILTERS_KEY, ALERT_SETTINGS_KEY, passesFilters, type CalendarFilters } from './calendar-filters.store';
import { CALENDAR_DEFAULTS } from './calendar-settings.defaults';
import { testEvent } from './calendar-test-events';

function filters(overrides: Partial<CalendarFilters> = {}): CalendarFilters {
  return { impacts: ['medium', 'high', 'holiday'], countries: ['USD', 'EUR', 'GBP'], hideRemoved: false, ...overrides };
}

describe('passesFilters — impact is a set (§11.2)', () => {
  it('holiday alone shows holidays and nothing else', () => {
    const f = filters({ impacts: ['holiday'] });
    expect(passesFilters(testEvent({ impact: 'holiday' }), f)).toBe(true);
    expect(passesFilters(testEvent({ impact: 'high' }), f)).toBe(false);
    expect(passesFilters(testEvent({ impact: 'unknown' }), f)).toBe(false);
  });

  it('medium + high without holiday hides holidays (the old ladder let them through)', () => {
    const f = filters({ impacts: ['medium', 'high'] });
    expect(passesFilters(testEvent({ impact: 'medium' }), f)).toBe(true);
    expect(passesFilters(testEvent({ impact: 'high' }), f)).toBe(true);
    expect(passesFilters(testEvent({ impact: 'holiday' }), f)).toBe(false);
    expect(passesFilters(testEvent({ impact: 'unknown' }), f)).toBe(false);
    expect(passesFilters(testEvent({ impact: 'low' }), f)).toBe(false);
  });

  it('unknown is its own chip', () => {
    expect(passesFilters(testEvent({ impact: 'unknown' }), filters({ impacts: ['unknown'] }))).toBe(true);
    expect(passesFilters(testEvent({ impact: 'unknown' }), filters())).toBe(false);
  });

  it("country 'All' passes whenever any currency is selected, and not when none is", () => {
    expect(passesFilters(testEvent({ country: 'All' }), filters({ countries: ['JPY'] }))).toBe(true);
    expect(passesFilters(testEvent({ country: 'All' }), filters({ countries: [] }))).toBe(false);
  });

  it('countries is an explicit list: empty means none, not all', () => {
    expect(passesFilters(testEvent({ country: 'USD' }), filters({ countries: [] }))).toBe(false);
    expect(passesFilters(testEvent({ country: 'JPY' }), filters())).toBe(false);
    expect(passesFilters(testEvent({ country: 'EUR' }), filters())).toBe(true);
  });

  it('hideRemoved still drops removed rows', () => {
    expect(passesFilters(testEvent({ status: 'removed' }), filters({ hideRemoved: true }))).toBe(false);
    expect(passesFilters(testEvent({ status: 'removed' }), filters())).toBe(true);
  });
});

describe('CalendarFiltersStore (§11.2, §11.3)', () => {
  beforeEach(() => localStorage.clear());

  it('applies CALENDAR_DEFAULTS on empty storage', () => {
    const store = new CalendarFiltersStore();
    expect(store.filters()).toEqual({ impacts: ['medium', 'high', 'holiday'], countries: ['USD', 'EUR', 'GBP'], hideRemoved: false });
    expect(store.alert()).toEqual({ enabled: false, leadMinutes: 5 });
  });

  it('discards the v1 key and does not migrate it', () => {
    localStorage.setItem(LEGACY_FILTERS_KEY, JSON.stringify({ minImpact: 'low', countries: [], hideRemoved: true }));
    const store = new CalendarFiltersStore();
    expect(store.filters().countries).toEqual(['USD', 'EUR', 'GBP']);
    expect(store.filters().hideRemoved).toBe(false);
    expect(localStorage.getItem(LEGACY_FILTERS_KEY)).toBeNull();
  });

  it('reads the v2 key, dropping unknown impact values', () => {
    localStorage.setItem(FILTERS_KEY, JSON.stringify({ impacts: ['holiday', 'bogus'], countries: [], hideRemoved: true }));
    const store = new CalendarFiltersStore();
    expect(store.filters()).toEqual({ impacts: ['holiday'], countries: [], hideRemoved: true });
  });

  it('persists every change and restores it on a fresh instance', () => {
    const store = new CalendarFiltersStore();
    store.toggleImpact('holiday');
    store.toggleImpact('low');
    store.toggleCountry('GBP');
    store.toggleCountry('JPY');
    store.setLeadMinutes(15);
    store.setAlertEnabled(true);

    const restored = new CalendarFiltersStore();
    expect(restored.filters().impacts).toEqual(['medium', 'high', 'low']);
    expect(restored.filters().countries).toEqual(['USD', 'EUR', 'JPY']);
    expect(restored.alert()).toEqual({ enabled: true, leadMinutes: 15 });
  });

  it('rejects a lead time outside the offered choices', () => {
    const store = new CalendarFiltersStore();
    store.setLeadMinutes(7);
    expect(store.alert().leadMinutes).toBe(5);
    localStorage.setItem(ALERT_SETTINGS_KEY, JSON.stringify({ enabled: true, leadMinutes: 7 }));
    expect(new CalendarFiltersStore().alert()).toEqual({ enabled: true, leadMinutes: 5 });
  });

  it('reset to defaults restores filters and alert settings, persisted', () => {
    const store = new CalendarFiltersStore();
    store.setCountries([]);
    store.toggleImpact('medium');
    store.setHideRemoved(true);
    store.setAlertEnabled(true);
    store.setLeadMinutes(30);

    store.resetToDefaults();
    expect(store.filters()).toEqual({ impacts: [...CALENDAR_DEFAULTS.impacts], countries: [...CALENDAR_DEFAULTS.countries], hideRemoved: false });
    expect(store.alert()).toEqual({ ...CALENDAR_DEFAULTS.alert });
    expect(new CalendarFiltersStore().filters()).toEqual(store.filters());
  });

  it('reset does not hand out the frozen defaults (later toggles still work)', () => {
    const store = new CalendarFiltersStore();
    store.resetToDefaults();
    store.toggleImpact('low');
    expect(store.filters().impacts).toContain('low');
    expect(CALENDAR_DEFAULTS.impacts).not.toContain('low');
  });
});
