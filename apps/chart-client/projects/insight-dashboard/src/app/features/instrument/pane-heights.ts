import type { PanelDef } from './panels.model';

/**
 * The instrument chart's pane heights, remembered between reloads (user, 2026-10-24).
 *
 * **Pixels, and the chart is as tall as their sum.** Dragging a pane's lower edge makes that pane
 * taller and pushes every pane under it down; nothing else shrinks (user, 2026-10-24, after the
 * first cut traded height between neighbours inside a fixed-height chart). The page scrolls
 * instead, so a pixel height saved on a tall screen cannot overflow a short one.
 *
 * Storage is `localStorage` in practice, but every function takes the store as an argument so the
 * spec can hand it one that throws, which is what a private window or blocked site data does.
 * The key is v2: v1 held shares of a fixed height, which mean nothing in pixels, so a v1 entry is
 * simply not read and the defaults apply once.
 */
export type PaneKey = PanelDef['key'];
export type PaneHeights = Record<PaneKey, number>;

export const PANE_HEIGHTS_STORAGE_KEY = 'insight.instrument.paneHeights.v2';

/** Price about half a laptop screen; the four indicators a readable strip each. */
export const DEFAULT_PANE_HEIGHTS: Readonly<PaneHeights> = {
  price: 420,
  openInterest: 110,
  delta: 110,
  funding: 110,
  longShort: 110,
};

/** No pane can be smaller than this: a pane dragged to nothing is still findable and grabbable. */
export const MIN_PANE_HEIGHT = 48;
/** Nor taller than this, so a stray drag cannot make a pane longer than any screen. */
export const MAX_PANE_HEIGHT = 2000;

const KEYS = Object.keys(DEFAULT_PANE_HEIGHTS) as PaneKey[];

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const defaults = (): PaneHeights => ({ ...DEFAULT_PANE_HEIGHTS });

export const clampPaneHeight = (px: number): number =>
  Math.round(Math.min(MAX_PANE_HEIGHT, Math.max(MIN_PANE_HEIGHT, px)));

/**
 * Any stored value made safe: missing or junk entries take their default and every height is
 * clamped. Something that is not an object at all gives the defaults.
 */
export function normaliseHeights(raw: unknown): PaneHeights {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return defaults();
  const source = raw as Record<string, unknown>;
  const picked = {} as PaneHeights;
  for (const key of KEYS) {
    const v = source[key];
    picked[key] = typeof v === 'number' && Number.isFinite(v) && v > 0 ? clampPaneHeight(v) : DEFAULT_PANE_HEIGHTS[key];
  }
  return picked;
}

/** One pane's new height after its lower edge moved by `dy` px; every other pane keeps its own. */
export function resizePane(heights: Readonly<PaneHeights>, key: PaneKey, startHeight: number, dy: number): PaneHeights {
  return { ...heights, [key]: clampPaneHeight(startHeight + dy) };
}

/** The panes' heights end to end, which is what the chart's height is built from. */
export function totalPaneHeight(heights: Readonly<PaneHeights>): number {
  return KEYS.reduce((acc, key) => acc + heights[key], 0);
}

/** The remembered heights, or the defaults when there are none or the store cannot be read. */
export function loadPaneHeights(store: KeyValueStore | null): PaneHeights {
  if (!store) return defaults();
  try {
    const raw = store.getItem(PANE_HEIGHTS_STORAGE_KEY);
    return raw === null ? defaults() : normaliseHeights(JSON.parse(raw));
  } catch {
    return defaults();
  }
}

/** Remembers the heights. A store that refuses keeps them for this visit only, silently. */
export function savePaneHeights(store: KeyValueStore | null, heights: Readonly<PaneHeights>): void {
  if (!store) return;
  try {
    store.setItem(PANE_HEIGHTS_STORAGE_KEY, JSON.stringify(heights));
  } catch {
    // blocked storage: the heights last until the page is closed
  }
}

/** `window.localStorage`, or null where touching it throws (some privacy modes do). */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}
