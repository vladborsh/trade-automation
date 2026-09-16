import { ViewStore } from './view.store';

describe('ViewStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to the charts view when nothing is stored', () => {
    const store = new ViewStore();
    expect(store.activeView()).toBe('charts');
  });

  it('toggle switches between charts and calendar', () => {
    const store = new ViewStore();
    store.toggle();
    expect(store.activeView()).toBe('calendar');
    store.toggle();
    expect(store.activeView()).toBe('charts');
  });

  it('restores the active view from localStorage on a fresh instance (reload simulation)', () => {
    const store = new ViewStore();
    store.set('calendar');

    const restored = new ViewStore();
    expect(restored.activeView()).toBe('calendar');
  });

  it('ignores a corrupt/unexpected stored value and falls back to charts', () => {
    localStorage.setItem('chart-client:active-view', 'not-a-real-view');
    const store = new ViewStore();
    expect(store.activeView()).toBe('charts');
  });
});
