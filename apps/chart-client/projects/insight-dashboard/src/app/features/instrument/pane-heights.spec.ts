import {
  DEFAULT_PANE_FRACTIONS, MIN_PANE_FRACTION, PANE_HEIGHTS_STORAGE_KEY, fractionsDiffer,
  fractionsFromStretch, loadPaneFractions, normaliseFractions, savePaneFractions,
  type KeyValueStore, type PaneFractions,
} from './pane-heights';

const sum = (f: PaneFractions): number => Object.values(f).reduce((a, b) => a + b, 0);

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
const CUSTOM: PaneFractions = { price: 0.3, openInterest: 0.25, delta: 0.15, funding: 0.2, longShort: 0.1 };

describe('pane heights', () => {
  it('the defaults sum to one and give price the largest share', () => {
    expect(sum(DEFAULT_PANE_FRACTIONS)).toBeCloseTo(1, 10);
    const others = Object.entries(DEFAULT_PANE_FRACTIONS).filter(([k]) => k !== 'price').map(([, v]) => v);
    expect(Math.max(...others)).toBeLessThan(DEFAULT_PANE_FRACTIONS.price);
  });

  it('survives a reload: what is saved is what is loaded', () => {
    const store = memoryStore();
    savePaneFractions(store, CUSTOM);
    expect(store.data[PANE_HEIGHTS_STORAGE_KEY]).toBeDefined();
    const loaded = loadPaneFractions(store);
    for (const key of Object.keys(CUSTOM) as Array<keyof PaneFractions>) expect(loaded[key]).toBeCloseTo(CUSTOM[key], 10);
  });

  it('falls back to the defaults on nothing stored, junk JSON, a non-object, or a store that throws', () => {
    expect(loadPaneFractions(memoryStore())).toEqual(DEFAULT_PANE_FRACTIONS);
    expect(loadPaneFractions(memoryStore({ [PANE_HEIGHTS_STORAGE_KEY]: '{not json' }))).toEqual(DEFAULT_PANE_FRACTIONS);
    expect(loadPaneFractions(memoryStore({ [PANE_HEIGHTS_STORAGE_KEY]: '[1,2,3]' }))).toEqual(DEFAULT_PANE_FRACTIONS);
    expect(loadPaneFractions(throwingStore)).toEqual(DEFAULT_PANE_FRACTIONS);
    expect(loadPaneFractions(null)).toEqual(DEFAULT_PANE_FRACTIONS);
  });

  it('a store that refuses to save does not throw', () => {
    expect(() => savePaneFractions(throwingStore, CUSTOM)).not.toThrow();
  });

  it('fills a missing pane with its default and rescales to one', () => {
    const f = normaliseFractions({ price: 0.8, openInterest: 'tall', delta: -1, funding: Number.NaN });
    expect(sum(f)).toBeCloseTo(1, 10);
    // price kept its relative weight against the defaulted others
    expect(f.price).toBeGreaterThan(f.openInterest * 5);
  });

  it('never stores a pane smaller than the minimum share', () => {
    const f = normaliseFractions({ price: 0.999, openInterest: 0.0001, delta: 0.0001, funding: 0.0001, longShort: 0.0001 });
    for (const v of Object.values(f)) expect(v).toBeGreaterThanOrEqual(MIN_PANE_FRACTION * 0.8);
  });

  it('stretch factors at any scale become the same shares', () => {
    // the library's own default factors are in the hundreds; a drag rewrites them freely
    const f = fractionsFromStretch({ price: 600, openInterest: 100, delta: 100, funding: 100, longShort: 100 });
    expect(f).not.toBeNull();
    expect(f!.price).toBeCloseTo(0.6, 10);
    expect(sum(f!)).toBeCloseTo(1, 10);
    const same = fractionsFromStretch({ price: 6, openInterest: 1, delta: 1, funding: 1, longShort: 1 });
    expect(same!.price).toBeCloseTo(f!.price, 10);
  });

  it('nothing positive to divide by gives null, not NaN shares', () => {
    expect(fractionsFromStretch({ price: 0, openInterest: 0, delta: 0, funding: 0, longShort: 0 })).toBeNull();
  });

  it('tells a real change from rounding noise', () => {
    expect(fractionsDiffer(CUSTOM, { ...CUSTOM, price: CUSTOM.price + 0.0004 })).toBe(false);
    expect(fractionsDiffer(CUSTOM, DEFAULT_PANE_FRACTIONS)).toBe(true);
  });
});
