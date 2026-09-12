import { Injectable, computed, signal } from '@angular/core';
import type { Layout } from '@trade-automation/contracts';

const ACTIVE_LAYOUT_KEY = 'chart-client:active-layout';

/**
 * architecture/chart-layouts.md §2.3 / §6.1 — Layout[] + the id of the
 * active layout. Replaces the per-instrument selection that used to live on
 * `InstrumentsStore` (`chart-client:selected-instrument`, now retired).
 */
@Injectable({ providedIn: 'root' })
export class LayoutsStore {
  private readonly list = signal<Layout[]>([]);
  private readonly activeId = signal<string | null>(null);

  readonly layouts = this.list.asReadonly();
  readonly active = computed(() => {
    const id = this.activeId();
    return id ? (this.list().find((l) => l.id === id) ?? null) : null;
  });

  /** Restores the stored layout id if it still exists in the served list, else the first layout. */
  setLayouts(layouts: Layout[]): void {
    this.list.set(layouts);
    if (!this.activeId() && layouts.length > 0) {
      const restored = this.readStoredActiveId();
      const initial = layouts.find((l) => l.id === restored) ?? layouts[0];
      this.select(initial.id);
    }
  }

  select(id: string): void {
    this.activeId.set(id);
    try {
      localStorage.setItem(ACTIVE_LAYOUT_KEY, id);
    } catch {
      // localStorage unavailable (private mode, etc.) — selection still works in-memory
    }
  }

  private readStoredActiveId(): string | null {
    try {
      return localStorage.getItem(ACTIVE_LAYOUT_KEY);
    } catch {
      return null;
    }
  }
}
