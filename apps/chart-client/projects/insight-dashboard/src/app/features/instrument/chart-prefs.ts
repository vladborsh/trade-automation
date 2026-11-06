import type { OiDivergenceKind } from '@trade-automation/contracts';
import type { KeyValueStore } from './pane-heights';

/**
 * IB-099 — the reader's chart preferences that outlive a visit: today, whether the pane legends
 * are hidden. Per viewer, in localStorage; a store that throws (private modes) or is absent is a
 * preference for this visit only — never an error on the page.
 */
export const LEGENDS_HIDDEN_KEY = 'insight.instrument.legendsHidden';

export function loadLegendsHidden(store: KeyValueStore | null): boolean {
  if (!store) return false;
  try {
    return store.getItem(LEGENDS_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveLegendsHidden(store: KeyValueStore | null, hidden: boolean): void {
  if (!store) return;
  try {
    store.setItem(LEGENDS_HIDDEN_KEY, hidden ? '1' : '0');
  } catch {
    // blocked storage: the choice lasts until the page is closed
  }
}

/** IB-110: whether the OI divergence lines are hidden (the «Дивергенции OI» legend entry). Same store, same rules. */
export const DIVERGENCES_HIDDEN_KEY = 'insight.instrument.divergencesHidden';
/** IB-144 (V44): the hidden-kind lines have a switch of their own («Скрытые дивергенции OI»). */
export const HIDDEN_DIVERGENCES_HIDDEN_KEY = 'insight.instrument.hiddenDivergencesHidden';

const DIVERGENCE_KEYS: Record<OiDivergenceKind, string> = { regular: DIVERGENCES_HIDDEN_KEY, hidden: HIDDEN_DIVERGENCES_HIDDEN_KEY };

export function loadDivergencesHidden(store: KeyValueStore | null, kind: OiDivergenceKind = 'regular'): boolean {
  if (!store) return false;
  try {
    return store.getItem(DIVERGENCE_KEYS[kind]) === '1';
  } catch {
    return false;
  }
}

export function saveDivergencesHidden(store: KeyValueStore | null, hidden: boolean, kind: OiDivergenceKind = 'regular'): void {
  if (!store) return;
  try {
    store.setItem(DIVERGENCE_KEYS[kind], hidden ? '1' : '0');
  } catch {
    // blocked storage: the choice lasts until the page is closed
  }
}

/**
 * IB-129 (alerts design §5) — the other chart layers with a legend switch: the liquidation and funding alert
 * marks, and the PMH/PML, weekly-open and monthly-open lines; IB-128: an admin's custom levels. Each kind is its own
 * switch, shown by default.
 */
export const CHART_LAYERS = ['liqAlerts', 'fundingAlerts', 'prevMonth', 'weekOpen', 'monthOpen', 'customLevels'] as const;
export type ChartLayer = (typeof CHART_LAYERS)[number];

export const layerHiddenKey = (layer: ChartLayer): string => `insight.instrument.layerHidden.${layer}`;

export function loadLayerHidden(store: KeyValueStore | null, layer: ChartLayer): boolean {
  if (!store) return false;
  try {
    return store.getItem(layerHiddenKey(layer)) === '1';
  } catch {
    return false;
  }
}

export function saveLayerHidden(store: KeyValueStore | null, layer: ChartLayer, hidden: boolean): void {
  if (!store) return;
  try {
    store.setItem(layerHiddenKey(layer), hidden ? '1' : '0');
  } catch {
    // blocked storage: the choice lasts until the page is closed
  }
}

/**
 * IB-129 (TL review): on a phone (≤ 480 px) the price legend is folded behind one «Слои (N)» control, closed
 * by default; whether the reader opened it is remembered here. Desktop ignores it (the legend is always open).
 */
export const PHONE_LAYERS_OPEN_KEY = 'insight.instrument.phoneLayersOpen';

export function loadPhoneLayersOpen(store: KeyValueStore | null): boolean {
  if (!store) return false;
  try {
    return store.getItem(PHONE_LAYERS_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function savePhoneLayersOpen(store: KeyValueStore | null, open: boolean): void {
  if (!store) return;
  try {
    store.setItem(PHONE_LAYERS_OPEN_KEY, open ? '1' : '0');
  } catch {
    // blocked storage: the choice lasts until the page is closed
  }
}
