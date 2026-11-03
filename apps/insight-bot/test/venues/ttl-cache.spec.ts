import { SWEEP_EVERY_MS, TtlCache, windowKey } from '../../src/venues/ttl-cache';

describe('TtlCache (WD-008)', () => {
  let t = 0;
  const cache = (maxEntries = 3) => new TtlCache({ maxEntries, now: () => t });
  beforeEach(() => { t = 1_000_000; });

  it('serves a value until its TTL runs out, then forgets it', () => {
    const c = cache();
    c.set('k', 1, 100);
    t += 99;
    expect(c.get('k')).toBe(1);
    t += 1;
    expect(c.get('k')).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it('is bounded: the least recently used entry goes first', () => {
    const c = cache(2);
    c.set('a', 1, 1_000);
    c.set('b', 2, 1_000);
    expect(c.get('a')).toBe(1); // a is now the most recent
    c.set('c', 3, 1_000);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
  });

  it('shares one load between concurrent readers of a missing key', async () => {
    const c = cache();
    let loads = 0;
    let release!: (v: number) => void;
    const load = () => { loads += 1; return new Promise<number>((r) => { release = r; }); };
    const both = Promise.all([c.getOrLoad('k', 100, load), c.getOrLoad('k', 100, load)]);
    release(7);
    expect(await both).toEqual([7, 7]);
    expect(loads).toBe(1);
    expect(await c.getOrLoad('k', 100, load)).toBe(7);
    expect(loads).toBe(1);
  });

  it('does not cache a failure: the next read loads again', async () => {
    const c = cache();
    await expect(c.getOrLoad('k', 100, () => Promise.reject(new Error('venue down')))).rejects.toThrow('venue down');
    expect(await c.getOrLoad('k', 100, async () => 5)).toBe(5);
  });

  it('keeps a value out when cacheIf says so (a partial answer)', async () => {
    const c = cache();
    let loads = 0;
    const load = async () => { loads += 1; return { unavailable: ['okx'] }; };
    await c.getOrLoad('k', 100, load, (v) => v.unavailable.length === 0);
    await c.getOrLoad('k', 100, load, (v) => v.unavailable.length === 0);
    expect(loads).toBe(2);
  });
});

describe('TtlCache sweep (IB-096): an expired entry is not held until someone reads its key', () => {
  it('inserting drops every expired entry, so dead windows stop holding memory', () => {
    let now = 0;
    const cache = new TtlCache({ now: () => now });
    for (let i = 0; i < 50; i++) cache.set(`old-${i}`, i, 1_000);
    now = 20_000; // all 50 expired; none read again (a window key moves with now)
    cache.set('new', 1, 60_000);
    expect(cache.size).toBe(1);
    expect(cache.stats()).toEqual([{ family: 'new', entries: 1, expired: 0 }]);
  });

  it('at most one pass per SWEEP_EVERY_MS: a burst of inserts does not rescan the map each time', () => {
    let now = 0;
    const cache = new TtlCache({ now: () => now });
    cache.set('a', 1, 5); // first insert sweeps an empty map and arms the timer
    now = 10; // 'a' expired, but the last sweep was 10 ms ago
    cache.set('b', 1, 60_000);
    expect(cache.size).toBe(2);
    now = SWEEP_EVERY_MS + 10;
    cache.set('c', 1, 60_000);
    expect(cache.size).toBe(2); // 'a' swept, 'b' and 'c' live
  });
});

describe('windowKey (WD-008)', () => {
  const HOUR = 3_600_000;
  const base = { venue: 'binance', market: 'perp', symbol: 'BTCUSDT', tf: 'funding' };

  it('a drifting `to` inside one step lands on one key', () => {
    const from = 10 * HOUR + 123;
    const a = windowKey({ ...base, fromMs: from, toMs: 20 * HOUR + 1 }, HOUR);
    const b = windowKey({ ...base, fromMs: from + 5_000, toMs: 21 * HOUR }, HOUR);
    expect(a).toBe(b);
    expect(a).toBe('binance|perp|BTCUSDT|funding|36000000|75600000');
  });

  it('a `to` crossing a step boundary is a different key, and so is every other part', () => {
    const k = windowKey({ ...base, fromMs: 0, toMs: HOUR }, HOUR);
    expect(windowKey({ ...base, fromMs: 0, toMs: HOUR + 1 }, HOUR)).not.toBe(k);
    expect(windowKey({ ...base, symbol: 'ETHUSDT', fromMs: 0, toMs: HOUR }, HOUR)).not.toBe(k);
    expect(windowKey({ ...base, tf: 'oi.1h', fromMs: 0, toMs: HOUR }, HOUR)).not.toBe(k);
  });
});
