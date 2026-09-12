import { Injectable, computed, signal } from '@angular/core';
import type { InstrumentId, InstrumentWithStatus } from '../contracts/contracts';

const LAST_SELECTED_KEY = 'chart-client:selected-instrument';

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
    if (!this.selectedId() && instruments.length > 0) {
      const restored = this.readLastSelected();
      const initial = instruments.find((i) => i.id === restored) ?? instruments[0];
      this.select(initial.id);
    }
  }

  select(id: InstrumentId): void {
    this.selectedId.set(id);
    try {
      localStorage.setItem(LAST_SELECTED_KEY, id);
    } catch {
      // localStorage unavailable (private mode, etc.) — selection still works in-memory
    }
  }

  private readLastSelected(): string | null {
    try {
      return localStorage.getItem(LAST_SELECTED_KEY);
    } catch {
      return null;
    }
  }

  updateVenueStatus(id: InstrumentId, venueStatus: InstrumentWithStatus['venueStatus']): void {
    this.list.update((items) => items.map((i) => (i.id === id ? { ...i, venueStatus } : i)));
  }
}
