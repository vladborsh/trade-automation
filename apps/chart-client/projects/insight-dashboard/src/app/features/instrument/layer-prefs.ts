import { Injectable, signal } from '@angular/core';
import { browserStore } from './pane-heights';
import {
  CHART_LAYERS, loadLayerHidden, loadPhoneLayersOpen, saveLayerHidden, savePhoneLayersOpen, type ChartLayer,
} from './chart-prefs';

export type LayersOff = Readonly<Record<ChartLayer, boolean>>;
export const NO_LAYERS_OFF: LayersOff = { liqAlerts: false, fundingAlerts: false, prevMonth: false, weekOpen: false, monthOpen: false, customLevels: false };

/**
 * IB-129 — the legend switches for the alert marks and the month/open level lines, one per kind, remembered
 * per viewer like the divergence switches (`divergence-prefs.ts`). Shared by the page, which leaves a hidden
 * layer out of the chart's data, and the chart's legend, whose entries flip them.
 */
@Injectable({ providedIn: 'root' })
export class LayerPrefs {
  private readonly store = browserStore();
  readonly off = signal<LayersOff>(Object.fromEntries(CHART_LAYERS.map((l) => [l, loadLayerHidden(this.store, l)])) as LayersOff);

  /** TL review: on a phone the price legend is folded behind «Слои (N)»; opened = true. Desktop ignores it. */
  readonly phoneOpen = signal(loadPhoneLayersOpen(this.store));

  togglePhone(): void {
    this.phoneOpen.update((o) => !o);
    savePhoneLayersOpen(this.store, this.phoneOpen());
  }

  toggle(layer: ChartLayer): void {
    const next = { ...this.off(), [layer]: !this.off()[layer] };
    this.off.set(next);
    saveLayerHidden(this.store, layer, next[layer]);
  }
}
