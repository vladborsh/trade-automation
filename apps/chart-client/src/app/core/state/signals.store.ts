import { Injectable, signal } from '@angular/core';
import type { Signal as TradeSignal } from '@trade-automation/contracts';

export function appendSignal(list: readonly TradeSignal[], incoming: TradeSignal): TradeSignal[] {
  if (list.some((s) => s.id === incoming.id)) {
    return list.slice();
  }
  return [...list, incoming].sort((a, b) => a.time - b.time);
}

/** Signal[] for the currently selected instrument: history load + live append. */
@Injectable({ providedIn: 'root' })
export class SignalsStore {
  private readonly list = signal<TradeSignal[]>([]);
  readonly signals = this.list.asReadonly();

  setHistory(signals: TradeSignal[]): void {
    this.list.set([...signals].sort((a, b) => a.time - b.time));
  }

  clear(): void {
    this.list.set([]);
  }

  append(signal: TradeSignal): void {
    this.list.update((current) => appendSignal(current, signal));
  }
}
