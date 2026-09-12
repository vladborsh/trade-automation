import { LayoutsStore } from './layouts.store';
import type { Layout } from '@trade-automation/contracts';

const ACTIVE_LAYOUT_KEY = 'chart-client:active-layout';

function layout(id: string): Layout {
  return {
    id,
    name: id,
    grid: { columns: 1, rows: 1 },
    panels: [{ id: 'p1', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }],
  };
}

describe('LayoutsStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('selects the first layout when nothing was previously stored', () => {
    const store = new LayoutsStore();
    store.setLayouts([layout('crypto'), layout('us-indices')]);
    expect(store.active()?.id).toBe('crypto');
  });

  it('restores the previously stored active layout id if it still exists', () => {
    localStorage.setItem(ACTIVE_LAYOUT_KEY, 'us-indices');
    const store = new LayoutsStore();
    store.setLayouts([layout('crypto'), layout('us-indices')]);
    expect(store.active()?.id).toBe('us-indices');
  });

  it('falls back to the first layout when the stored id no longer exists', () => {
    localStorage.setItem(ACTIVE_LAYOUT_KEY, 'deleted-layout');
    const store = new LayoutsStore();
    store.setLayouts([layout('crypto'), layout('us-indices')]);
    expect(store.active()?.id).toBe('crypto');
  });

  it('select() persists the chosen id to localStorage', () => {
    const store = new LayoutsStore();
    store.setLayouts([layout('crypto'), layout('us-indices')]);
    store.select('us-indices');
    expect(store.active()?.id).toBe('us-indices');
    expect(localStorage.getItem(ACTIVE_LAYOUT_KEY)).toBe('us-indices');
  });
});
