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
