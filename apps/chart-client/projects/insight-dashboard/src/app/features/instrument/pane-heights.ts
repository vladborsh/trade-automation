import type { PanelDef } from './panels.model';

/**
 * The instrument chart's pane heights, remembered between reloads (user, 2026-10-24).
 *
 * **Shares of the chart's height, not pixels.** A pixel height saved on a 1440 px-tall screen
 * would overflow a laptop's chart, so what is stored is each pane's share of the whole. The chart
 * library sizes panes by proportional stretch factors, so a share goes in and comes out as one.
 *
 * Storage is `localStorage` in practice, but every function takes the store as an argument so the
 * spec can hand it one that throws, which is what a private window or blocked site data does.
 */
export type PaneKey = PanelDef['key'];
export type PaneFractions = Record<PaneKey, number>;

export const PANE_HEIGHTS_STORAGE_KEY = 'insight.instrument.paneHeights.v1';

/** Price takes about half; the four indicators share the rest equally. Sums to 1. */
export const DEFAULT_PANE_FRACTIONS: Readonly<PaneFractions> = {
  price: 0.52,
  openInterest: 0.12,
  delta: 0.12,
  funding: 0.12,
  longShort: 0.12,
};

/** No pane can be stored smaller than this share: a pane dragged to nothing is still findable. */
export const MIN_PANE_FRACTION = 0.04;

const KEYS = Object.keys(DEFAULT_PANE_FRACTIONS) as PaneKey[];

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const defaults = (): PaneFractions => ({ ...DEFAULT_PANE_FRACTIONS });

/**
 * Any stored value made safe: missing or junk entries take their default, every share is at least
 * `MIN_PANE_FRACTION`, and the whole is rescaled to sum to 1. Something that is not an object at
 * all gives the defaults.
 */
export function normaliseFractions(raw: unknown): PaneFractions {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return defaults();
  const source = raw as Record<string, unknown>;
  const picked = {} as PaneFractions;
  for (const key of KEYS) {
    const v = source[key];
    picked[key] = typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.max(v, MIN_PANE_FRACTION) : DEFAULT_PANE_FRACTIONS[key];
  }
  const sum = KEYS.reduce((acc, key) => acc + picked[key], 0);
  for (const key of KEYS) picked[key] = picked[key] / sum;
  return picked;
}

/**
 * The chart's stretch factors as shares. lightweight-charts sizes panes in proportion to their
 * stretch factors, and a drag on a separator rewrites them, so they ARE the shares at an
 * arbitrary scale. Null when there is nothing positive to divide by.
 */
export function fractionsFromStretch(factors: Readonly<Record<PaneKey, number>>): PaneFractions | null {
  const total = KEYS.reduce((acc, key) => acc + Math.max(0, factors[key] ?? 0), 0);
  if (!(total > 0)) return null;
  const out = {} as Record<PaneKey, number>;
  for (const key of KEYS) out[key] = Math.max(0, factors[key] ?? 0) / total;
  return normaliseFractions(out);
}

/** The remembered shares, or the defaults when there are none or the store cannot be read. */
export function loadPaneFractions(store: KeyValueStore | null): PaneFractions {
  if (!store) return defaults();
  try {
    const raw = store.getItem(PANE_HEIGHTS_STORAGE_KEY);
    return raw === null ? defaults() : normaliseFractions(JSON.parse(raw));
  } catch {
    return defaults();
  }
}

/** Remembers the shares. A store that refuses keeps them for this visit only, silently. */
export function savePaneFractions(store: KeyValueStore | null, fractions: Readonly<PaneFractions>): void {
  if (!store) return;
  try {
    store.setItem(PANE_HEIGHTS_STORAGE_KEY, JSON.stringify(fractions));
  } catch {
    // blocked storage: the heights last until the page is closed
  }
}

/** True when two sets of shares differ by more than a pixel's worth on a tall screen. */
export function fractionsDiffer(a: Readonly<PaneFractions>, b: Readonly<PaneFractions>): boolean {
  return KEYS.some((key) => Math.abs(a[key] - b[key]) > 0.001);
}

/** `window.localStorage`, or null where touching it throws (some privacy modes do). */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}
