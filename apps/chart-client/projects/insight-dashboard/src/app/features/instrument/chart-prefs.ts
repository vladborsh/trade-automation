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
