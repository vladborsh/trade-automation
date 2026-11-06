import { Injectable, signal } from '@angular/core';
import { browserStore } from './pane-heights';
import { CHART_LAYERS, loadLayerHidden, saveLayerHidden, type ChartLayer } from './chart-prefs';

export type LayersOff = Readonly<Record<ChartLayer, boolean>>;
export const NO_LAYERS_OFF: LayersOff = { liqAlerts: false, fundingAlerts: false, prevMonth: false, weekOpen: false, monthOpen: false };

/**
 * IB-129 — the legend switches for the alert marks and the month/open level lines, one per kind, remembered
 * per viewer like the divergence switches (`divergence-prefs.ts`). Shared by the page, which leaves a hidden
 * layer out of the chart's data, and the chart's legend, whose entries flip them.
 */
@Injectable({ providedIn: 'root' })
export class LayerPrefs {
  private readonly store = browserStore();
  readonly off = signal<LayersOff>(Object.fromEntries(CHART_LAYERS.map((l) => [l, loadLayerHidden(this.store, l)])) as LayersOff);

  toggle(layer: ChartLayer): void {
    const next = { ...this.off(), [layer]: !this.off()[layer] };
    this.off.set(next);
    saveLayerHidden(this.store, layer, next[layer]);
  }
}
