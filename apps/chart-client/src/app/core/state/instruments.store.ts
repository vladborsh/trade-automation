import { Injectable, computed, signal } from '@angular/core';
import type { InstrumentId } from '@trade-automation/contracts';
import type { InstrumentWithStatus } from '../contracts/derived';

/**
 * architecture/chart-layouts.md §6.1 — the universe (displayName/precision/
 * status lookups), no longer paired with a single global "selected
 * instrument" persisted to localStorage: layouts replace that concept
 * (`LayoutsStore`, `chart-client:active-layout`) and the instrument switcher
 * that used to write here is removed.
 *
 * The `selected`/`select` pair stays on the class (not deleted) because
 * `ChartPanelComponent` provides a fresh, panel-scoped `InstrumentsStore`
 * instance per panel (Angular hierarchical DI) and immediately calls
 * `select(panel.instrument)` on it — that scoped instance is what the
 * VWAP client unit's `ResearchBadgeComponent` resolves via ordinary
 * constructor injection when rendered inside that panel, so it keeps
 * working unmodified with exactly one instrument in view instead of a
 * global one. This is a deliberate escalated deviation from this note's
 * literal "drop `selected`" instruction — see HANDOFF.md.
 */
@Injectable({ providedIn: 'root' })
export class InstrumentsStore {
  private readonly list = signal<InstrumentWithStatus[]>([]);
  private readonly selectedId = signal<InstrumentId | null>(null);

  readonly instruments = this.list.asReadonly();
  readonly selected = computed(() => {
    const id = this.selectedId();
    return id ? (this.list().find((i) => i.id === id) ?? null) : null;
  });

  setInstruments(instruments: InstrumentWithStatus[]): void {
    this.list.set(instruments);
  }

  select(id: InstrumentId): void {
    this.selectedId.set(id);
  }

  updateVenueStatus(id: InstrumentId, venueStatus: InstrumentWithStatus['venueStatus']): void {
    this.list.update((items) => items.map((i) => (i.id === id ? { ...i, venueStatus } : i)));
  }
}
