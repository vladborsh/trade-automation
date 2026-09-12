import { Injectable, signal } from '@angular/core';
import type { Timeframe } from '../contracts/contracts';

const ORDER: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
const LAST_SELECTED_KEY = 'chart-client:selected-timeframe';

@Injectable({ providedIn: 'root' })
export class TimeframeStore {
  private readonly current = signal<Timeframe>(this.readLastSelected() ?? '5m');
  readonly selected = this.current.asReadonly();

  select(tf: Timeframe): void {
    this.current.set(tf);
    try {
      localStorage.setItem(LAST_SELECTED_KEY, tf);
    } catch {
      // ignore — in-memory selection still works
    }
  }

  /** `]` shortcut: next coarser timeframe. */
  next(): void {
    const idx = ORDER.indexOf(this.current());
    this.select(ORDER[Math.min(idx + 1, ORDER.length - 1)]);
  }

  /** `[` shortcut: next finer timeframe. */
  previous(): void {
    const idx = ORDER.indexOf(this.current());
    this.select(ORDER[Math.max(idx - 1, 0)]);
  }

  private readLastSelected(): Timeframe | null {
    try {
      const stored = localStorage.getItem(LAST_SELECTED_KEY);
      return stored && (ORDER as string[]).includes(stored) ? (stored as Timeframe) : null;
    } catch {
      return null;
    }
  }
}
