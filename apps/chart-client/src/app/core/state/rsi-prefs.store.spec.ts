import { RsiPrefsStore } from './rsi-prefs.store';

const KEY = 'chart-client:rsi';

describe('RsiPrefsStore', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to visible everywhere, period 14', () => {
    const store = new RsiPrefsStore();
    expect(store.period()).toBe(14);
    expect(store.isVisible('crypto', 'btc')).toBe(true);
  });

  it('persists visibility per layout and the clamped period, and restores them on reload', () => {
    const store = new RsiPrefsStore();
    store.setVisible('crypto', 'btc', false);
    store.setPeriod('250');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ period: 100, hidden: { crypto: ['btc'] } });

    const reloaded = new RsiPrefsStore();
    expect(reloaded.period()).toBe(100);
    expect(reloaded.isVisible('crypto', 'btc')).toBe(false);
    expect(reloaded.isVisible('us-indices', 'btc')).toBe(true);
  });

  it('ignores a non-numeric period', () => {
    const store = new RsiPrefsStore();
    store.setPeriod('21');
    store.setPeriod('');
    expect(store.period()).toBe(21);
  });

  it('falls back to defaults on a corrupt stored value', () => {
    localStorage.setItem(KEY, '{broken');
    expect(new RsiPrefsStore().period()).toBe(14);
  });
});
