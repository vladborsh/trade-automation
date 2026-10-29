import {
  DEFAULT_PANE_HEIGHTS, MAX_PANE_HEIGHT, MIN_PANE_HEIGHT, PANE_HEIGHTS_STORAGE_KEY, loadPaneHeights,
  normaliseHeights, paneEdges, resizePane, savePaneHeights, totalPaneHeight, type KeyValueStore, type PaneHeights,
} from './pane-heights';
import { PANELS } from './panels.model';

/** A store backed by a map, so a spec can see exactly what was written. */
function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
}

const throwingStore: KeyValueStore = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
};

/** Deliberately unlike the defaults, so a spec that silently falls back cannot pass. */
const CUSTOM: PaneHeights = { price: 300, openInterest: 250, delta: 150, funding: 200, longShort: 100 };

describe('pane heights', () => {
  it('the defaults give price the tallest pane', () => {
    const others = Object.entries(DEFAULT_PANE_HEIGHTS).filter(([k]) => k !== 'price').map(([, v]) => v);
    expect(Math.max(...others)).toBeLessThan(DEFAULT_PANE_HEIGHTS.price);
  });

  it('survives a reload: what is saved is what is loaded', () => {
    const store = memoryStore();
    savePaneHeights(store, CUSTOM);
    expect(loadPaneHeights(store)).toEqual(CUSTOM);
  });

  it('gives the defaults when nothing is stored, the value is junk, or the store throws', () => {
    expect(loadPaneHeights(memoryStore())).toEqual(DEFAULT_PANE_HEIGHTS);
    expect(loadPaneHeights(memoryStore({ [PANE_HEIGHTS_STORAGE_KEY]: '{not json' }))).toEqual(DEFAULT_PANE_HEIGHTS);
    expect(loadPaneHeights(throwingStore)).toEqual(DEFAULT_PANE_HEIGHTS);
    expect(loadPaneHeights(null)).toEqual(DEFAULT_PANE_HEIGHTS);
    expect(() => savePaneHeights(throwingStore, CUSTOM)).not.toThrow();
  });

  it('does not read the old v1 shares as pixels', () => {
    const store = memoryStore({ 'insight.instrument.paneHeights.v1': JSON.stringify({ price: 0.3 }) });
    expect(loadPaneHeights(store)).toEqual(DEFAULT_PANE_HEIGHTS);
  });

  it('fills a missing or junk entry with its default and clamps the rest', () => {
    const out = normaliseHeights({ price: 5, openInterest: 'x', delta: 99_999, funding: -3 });
    expect(out.price).toBe(MIN_PANE_HEIGHT);
    expect(out.openInterest).toBe(DEFAULT_PANE_HEIGHTS.openInterest);
    expect(out.delta).toBe(MAX_PANE_HEIGHT);
    expect(out.funding).toBe(DEFAULT_PANE_HEIGHTS.funding);
    expect(out.longShort).toBe(DEFAULT_PANE_HEIGHTS.longShort);
    expect(normaliseHeights([1, 2])).toEqual(DEFAULT_PANE_HEIGHTS);
  });

  it('a drag grows only the dragged pane, so the chart grows by exactly the drag', () => {
    const next = resizePane(CUSTOM, 'openInterest', CUSTOM.openInterest, 80);
    expect(next.openInterest).toBe(330);
    for (const key of ['price', 'delta', 'funding', 'longShort'] as const) expect(next[key]).toBe(CUSTOM[key]);
    expect(totalPaneHeight(next)).toBe(totalPaneHeight(CUSTOM) + 80);
  });

  it('a drag up shrinks the pane, never below the minimum', () => {
    expect(resizePane(CUSTOM, 'price', 300, -1000).price).toBe(MIN_PANE_HEIGHT);
  });
});

describe('paneEdges', () => {
  it('stacks the panes with a 1 px separator, top to bottom in panel order', () => {
    const edges = paneEdges({ price: 300, openInterest: 100, delta: 100, funding: 80, longShort: 80 });
    expect(edges).toEqual([
      { key: 'price', top: 0, bottom: 300 },
      { key: 'openInterest', top: 301, bottom: 401 },
      { key: 'delta', top: 402, bottom: 502 },
      { key: 'funding', top: 503, bottom: 583 },
      { key: 'longShort', top: 584, bottom: 664 },
    ]);
  });

  it('is in the order the chart draws its panes', () => {
    expect(paneEdges(DEFAULT_PANE_HEIGHTS).map((e) => e.key)).toEqual(PANELS.map((p) => p.key));
  });
});
