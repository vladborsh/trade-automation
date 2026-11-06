import { FUNDING_DEFAULT_PARAMS, FundingEnterDetailsSchema, FundingFlipDetailsSchema, FundingNearMissDetailsSchema, type FundingParams, type MarketAlertSource } from '@trade-automation/contracts';
import { FundingAlertLoop, coinsOf, type FundingVenuePort } from '../../../src/alerts/funding/funding-alert-loop';
import { randomCheckSlots, randomSlotAt } from '../../../src/alerts/funding/controls';
import type { FundingSideState } from '../../../src/alerts/funding/funding-state';
import type { FundingAlertStore, FundingCommit, FundingSettings, NewFundingControl } from '../../../src/alerts/funding/pg/funding-alerts.repo';

/**
 * IB-124 (F1, F4–F8) — the loop over an in-memory store and a scripted venue: alert rows and state written together,
 * sent only while the switch is on, a stale rate ignored, a restart (a NEW loop on the same store) resuming
 * mid-episode, near-miss and random controls, the venue calls counted.
 */
const MIN = 60_000;
const H = 60 * MIN;
const STEP = 5 * MIN;
const T0 = Date.UTC(2026, 10, 6, 0, 2, 0); // 2 min past a 5-minute grid line

class MemoryStore implements FundingAlertStore {
  settingsRow: FundingSettings = { enabled: false, membersVisible: false, params: FUNDING_DEFAULT_PARAMS, updatedAt: 0 };
  coins = [{ symbol: 'BTCUSDT', base: 'BTC' }];
  rows = new Map<string, FundingSideState>();
  alerts: Array<{ id: number; event: string; symbol: string; direction: string; atMs: number; details: Record<string, unknown>; dedupeKey: string; firedAt: number | null; recipients: number }> = [];
  controls: Array<NewFundingControl & { id: number }> = [];
  paths: Array<{ subject: unknown; t0Sec: number }> = [];
  commits = 0;
  failCommit = false;
  private id = 0;

  async settings() { return this.settingsRow; }
  async listedCoins() { return this.coins; }
  async states(_source: MarketAlertSource) { return new Map([...this.rows].map(([k, v]) => [k, { ...v }])); }
  async commit(x: FundingCommit) {
    if (this.failCommit) throw new Error('db down');
    this.commits++;
    const ids = x.alerts.map((a) => {
      if (this.alerts.some((r) => r.dedupeKey === a.dedupeKey)) return null;
      const id = ++this.id;
      this.alerts.push({ id, ...a, firedAt: null, recipients: 0 });
      return id;
    });
    for (const s of x.states) this.rows.set(`${x.symbol}|${s.side}`, { ...s.state });
    return ids;
  }
  async insertControl(_s: MarketAlertSource, _b: string, _p: FundingParams, x: NewFundingControl) {
    if (this.controls.some((c) => c.dedupeKey === x.dedupeKey)) return null;
    const id = ++this.id;
    this.controls.push({ ...x, id });
    return id;
  }
  async insertPaths(subject: unknown, _symbol: string, t0Sec: number) { this.paths.push({ subject, t0Sec }); }
  async recipients() { return [{ chatId: 7, lang: 'ru' as const }, { chatId: 8, lang: 'en' as const }]; }
  async markFired(id: number, at: number, n: number) {
    const r = this.alerts.find((a) => a.id === id);
    if (r) { r.firedAt = at; r.recipients = n; }
  }
}

/** A month of ordinary 8 h settlements around +0.01 %. */
const HISTORY = Array.from({ length: 90 }, (_, i) => ({ time: Math.floor(T0 / 1000) - (90 - i) * 8 * 3600, rate: [0.0001, 0.00005, 0.00015, 0.00008, 0.00012][i % 5] as number }));

class Venue implements FundingVenuePort {
  rate = 0.0001;
  lagMs = 1_000;
  calls = { premium: 0, settled: 0 };
  async premiumIndex(_s: string) {
    this.calls.premium++;
    return { rate: this.rate, timeMs: this.now - this.lagMs, nextFundingTimeMs: this.now + H };
  }
  async settled(_s: string) { this.calls.settled++; return HISTORY; }
  now = T0;
}

function harness(store = new MemoryStore(), venue = new Venue()) {
  const sent: Array<[number, string]> = [];
  const loop = new FundingAlertLoop({
    store, venue, webBaseUrl: 'https://insight.example', build: 'dev', source: 'live',
    send: async (chatId, text) => { sent.push([chatId, text]); return true; },
  });
  let now = T0;
  const tick = async (rate?: number) => {
    if (rate !== undefined) venue.rate = rate;
    venue.now = now;
    const r = await loop.tick(now);
    now += STEP;
    return r;
  };
  return { store, venue, sent, loop, tick, at: () => now, setNow: (t: number) => { now = t; } };
}

describe('IB-124 funding alert loop (F1, F4–F8)', () => {
  it('F4: an entry is journalled with its state, sent to nobody while the switch is off; its details parse; a path is queued', async () => {
    const h = harness();
    await h.tick(0.0001);
    await h.tick(0.0005);
    await h.tick(0.0005);
    expect(h.store.alerts.map((a) => [a.event, a.direction, a.atMs])).toEqual([['enter', 'bearish', T0 + STEP]]);
    expect(FundingEnterDetailsSchema.safeParse(h.store.alerts[0]?.details).success).toBe(true);
    expect(h.store.alerts[0]?.dedupeKey).toBe(`funding:BTCUSDT:high:${T0 + STEP}`);
    expect(h.store.rows.get('BTCUSDT|high')).toMatchObject({ zone: 'extreme', since: T0 + STEP });
    expect(h.sent).toEqual([]);
    expect(h.store.alerts[0]?.firedAt).toBeNull();
    expect(h.store.paths.filter((p) => (p.subject as { marketAlertId?: number }).marketAlertId === 1).map((p) => p.t0Sec)).toEqual([Math.ceil((T0 + STEP) / 1000 / 300) * 300]);
  });

  it('sent only while the switch is on, to each recipient in their language, with the link at the episode start on 1h', async () => {
    const h = harness();
    h.store.settingsRow = { ...h.store.settingsRow, enabled: true };
    await h.tick(-0.0005);
    expect(h.sent.map(([c]) => c)).toEqual([7, 8]);
    expect(h.sent[0]?.[1]).toContain('Фандинг BTC в экстремуме: шорты платят лонгам');
    expect(h.sent[1]?.[1]).toContain('BTC funding at an extreme: shorts pay longs');
    expect(h.sent[0]?.[1]).toContain(`https://insight.example/instrument/BTCUSDT?at=${Math.floor(T0 / 1000)}&tf=1h`);
    expect(h.store.alerts[0]).toMatchObject({ firedAt: T0, recipients: 2, direction: 'bullish' });
  });

  it('F7: a rate more than 15 min old gives no signal and leaves the state as it was', async () => {
    const h = harness();
    h.venue.lagMs = 16 * MIN;
    const r = await h.tick(0.0005);
    expect(r).toMatchObject({ stale: 1, enters: 0 });
    expect(h.store.alerts).toEqual([]);
    expect(h.store.rows.size).toBe(0);
  });

  it('F6: a restart mid-episode (a NEW loop on the same store) sends no second enter, and the episode can still flip', async () => {
    const store = new MemoryStore();
    store.settingsRow = { ...store.settingsRow, enabled: true };
    const venue = new Venue();
    const a = harness(store, venue);
    for (let i = 0; i < 12 * 12; i++) await a.tick(0.0005); // 12 h extreme
    const b = harness(store, venue);
    b.setNow(a.at());
    for (let i = 0; i < 12 * 12 + 1; i++) await b.tick(0.0005); // 12 h 5 min more: 24 h 5 min in all
    for (let i = 0; i < 6; i++) await b.tick(-0.0001); // out (3), and the opposite sign held 6
    expect(store.alerts.map((x) => x.event)).toEqual(['enter', 'flip']);
    const flip = store.alerts[1] as { details: Record<string, unknown>; atMs: number; direction: string };
    expect(FundingFlipDetailsSchema.safeParse(flip.details).success).toBe(true);
    expect(flip.details).toMatchObject({ side: 'high', episodeStartMs: T0 });
    expect(flip.direction).toBe('bullish');
    expect(b.sent.filter(([, t]) => t.includes('сменил знак'))).toHaveLength(1);
    expect(b.sent.find(([, t]) => t.includes('сменил знак'))?.[1]).toContain('после 24 ч экстремума: теперь шорты платят лонгам');
  });

  it('a failed commit writes nothing and moves no state; the next check retries the same entry', async () => {
    const h = harness();
    h.store.failCommit = true;
    const r = await h.tick(0.0005);
    expect(r?.failed).toEqual(['BTCUSDT']);
    expect(h.store.alerts).toEqual([]);
    h.store.failCommit = false;
    await h.tick(0.0005);
    expect(h.store.alerts.map((a) => a.atMs)).toEqual([T0 + STEP]);
  });

  it('F8: a near-miss once per coin, side and UTC day, only while that side is normal', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) await h.tick(0.00025); // rare, inside the floor
    const nm = h.store.controls.filter((c) => c.kind === 'near_miss');
    expect(nm).toHaveLength(1);
    expect(nm[0]).toMatchObject({ direction: 'bearish', dedupeKey: 'funding-nm:BTCUSDT:high:2026-11-06' });
    expect(FundingNearMissDetailsSchema.safeParse(nm[0]?.details).success).toBe(true);
    expect((nm[0]?.details as { failed: string }).failed).toBe('floor');
    // the next UTC day: one more
    h.setNow(Date.UTC(2026, 10, 7, 0, 1));
    await h.tick(0.00025);
    expect(h.store.controls.filter((c) => c.kind === 'near_miss')).toHaveLength(2);
  });

  it('F8: no near-miss while the side is still in its episode (the re-arming streak is not an entry)', async () => {
    const h = harness();
    await h.tick(0.0005); // enter
    await h.tick(0.00025); // rare, inside the floor: outside the extreme, zone still extreme
    await h.tick(0.00025);
    expect(h.store.controls.filter((c) => c.kind === 'near_miss')).toEqual([]);
    await h.tick(0.00025); // the third: re-armed, normal → now it is a near-miss
    expect(h.store.controls.filter((c) => c.kind === 'near_miss')).toHaveLength(1);
  });

  it('F8: random checks are the 2 hash-picked slots of the day, with the rate and band recorded, direction-free', async () => {
    const h = harness();
    const day = Date.UTC(2026, 10, 6);
    const slots = randomCheckSlots('BTCUSDT', day);
    expect(slots).toHaveLength(2);
    for (const s of slots) {
      h.setNow(s + 2 * MIN);
      await h.tick(0.0001);
      h.setNow(s + 4 * MIN); // a second check in the same slot is absorbed
      await h.tick(0.0001);
    }
    const rnd = h.store.controls.filter((c) => c.kind === 'random');
    expect(rnd.map((c) => c.dedupeKey)).toEqual(slots.map((s) => `funding-rnd:BTCUSDT:${s}`));
    for (const s of slots) {
      expect(randomSlotAt('BTCUSDT', s)).toBe(s);
      expect(randomSlotAt('BTCUSDT', s + 5 * MIN - 1)).toBe(s);
      expect(randomSlotAt('BTCUSDT', s + 5 * MIN)).not.toBe(s); // the first moment after a slot is not in it
    }
    h.setNow(slots[0]! + 5 * MIN);
    await h.tick(0.0001);
    expect(h.store.controls.filter((c) => c.kind === 'random')).toHaveLength(2);
    expect(rnd.every((c) => c.direction === null && typeof (c.details as { band: unknown }).band === 'object')).toBe(true);
  });

  it('F1: one premiumIndex per coin per check; the 30-day history once an hour', async () => {
    const h = harness();
    for (let i = 0; i < 24; i++) await h.tick(0.0001); // 2 h of checks
    expect(h.venue.calls).toEqual({ premium: 24, settled: 2 });
  });

  it('coins: alert_symbols ∩ funding switch; a coin missing from perCoin is on at the shared floor; a coin floor is used', () => {
    const listed = [{ symbol: 'BTCUSDT', base: 'BTC' }, { symbol: 'ETHUSDT', base: 'ETH' }, { symbol: 'TRXUSDT', base: 'TRX' }];
    const params: FundingParams = { ...FUNDING_DEFAULT_PARAMS, perCoin: { ETHUSDT: { enabled: false }, TRXUSDT: { enabled: true, floorPer8h: 0.0005 } } };
    expect(coinsOf(listed, params)).toEqual([
      { symbol: 'BTCUSDT', base: 'BTC', floorPer8h: 0.0003 },
      { symbol: 'TRXUSDT', base: 'TRX', floorPer8h: 0.0005 },
    ]);
  });
});
