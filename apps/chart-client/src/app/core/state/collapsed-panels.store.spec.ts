import type { Layout } from '@trade-automation/contracts';
import { CollapsedPanelsStore } from './collapsed-panels.store';

const KEY = 'chart-client:collapsed-panels';

function layout(id: string, panelIds: string[]): Layout {
  return {
    id,
    name: id,
    grid: { columns: panelIds.length, rows: 1 },
    panels: panelIds.map((p) => ({
      id: p,
      kind: 'candles',
      instrument: 'binance:BTCUSDT',
      signals: false,
    })),
  };
}

describe('CollapsedPanelsStore', () => {
  const crypto = layout('crypto', ['btc', 'eth', 'btc-oi', 'dxy']);
  const indices = layout('us-indices', ['us100', 'us500', 'dxy']);

  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with every panel expanded', () => {
    const store = new CollapsedPanelsStore();
    expect(store.collapsedIds(crypto)).toEqual([]);
    expect(store.isCollapsed(crypto, 'eth')).toBe(false);
  });

  it('collapse/expand toggle one panel and persist per layout', () => {
    const store = new CollapsedPanelsStore();
    store.collapse(crypto, 'eth');
    expect(store.isCollapsed(crypto, 'eth')).toBe(true);
    expect(store.isCollapsed(indices, 'dxy')).toBe(false); // same panel id, other layout: independent
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ crypto: ['eth'] });

    store.expand(crypto, 'eth');
    expect(store.isCollapsed(crypto, 'eth')).toBe(false);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ crypto: [] });
  });

  it('restores the persisted state in a fresh instance (reload)', () => {
    new CollapsedPanelsStore().collapse(crypto, 'btc-oi');
    const reloaded = new CollapsedPanelsStore();
    expect(reloaded.collapsedIds(crypto)).toEqual(['btc-oi']);
  });

  it('the last expanded panel cannot be collapsed', () => {
    const store = new CollapsedPanelsStore();
    store.collapse(indices, 'us100');
    store.collapse(indices, 'us500');
    expect(store.canCollapse(indices, 'dxy')).toBe(false);
    store.collapse(indices, 'dxy');
    expect(store.collapsedIds(indices)).toEqual(['us100', 'us500']);
  });

  it('on load drops ids no longer in the layout', () => {
    localStorage.setItem(KEY, JSON.stringify({ crypto: ['eth', 'removed-panel'] }));
    expect(new CollapsedPanelsStore().collapsedIds(crypto)).toEqual(['eth']);
  });

  it('on load ignores a stored set that would collapse every panel', () => {
    localStorage.setItem(KEY, JSON.stringify({ 'us-indices': ['us100', 'us500', 'dxy'] }));
    const store = new CollapsedPanelsStore();
    expect(store.collapsedIds(indices)).toEqual([]);
    expect(store.canCollapse(indices, 'dxy')).toBe(true);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem(KEY, 'not json');
    expect(new CollapsedPanelsStore().collapsedIds(crypto)).toEqual([]);
  });
});
