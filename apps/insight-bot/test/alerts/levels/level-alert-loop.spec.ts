import {
  LEVEL_DEFAULT_PARAMS, LevelAlertDetailsSchema, LevelRandomDetailsSchema, LevelTouchDetailsSchema, type LevelBar, type LevelParams, type MarketAlertSource,
  type WebCandle,
} from '@trade-automation/contracts';
import { LEVEL_CATCHUP_BARS, LevelAlertLoop, coinsOf, dueBarOpen, type LevelVenuePort } from '../../../src/alerts/levels/level-alert-loop';
import { randomBarOpens } from '../../../src/alerts/levels/controls';
import type { LevelState } from '../../../src/alerts/levels/level-step';
import { stateKey, type LevelAlertStore, type LevelCommit, type LevelSettings, type LevelStateRow, type NewLevelControl } from '../../../src/alerts/levels/pg/level-alerts.repo';
import { klinesWeight } from '../../../src/news/reaction-prices';

/**
 * IB-126 (P2–P7, P10) — the loop over an in-memory store and a scripted venue. Levels on Wednesday 2026-11-11:
 * PWH 100 / PWL 80 (week of 11-02), PMH 120 / PML 60 (October), weekly open 90 (Monday 11-09), monthly open 85
 * (11-01), PDH 95 / PDL 85 (11-10, off by default). Every 15m close is 92 unless a test scripts it.
 */
const M = 900_000;
const DAY = 86_400_000;
const utc = (m: number, d: number, h = 0, min = 0) => Date.UTC(2026, m - 1, d, h, min);
const T = utc(11, 11, 10); // a bar open, Wednesday 10:00
/** The moment the bar opening at `open` is evaluated (closed + 5 s). */
const evalAt = (open: number) => open + M + 5_000;

function dailyCandles(): WebCandle[] {
  const out: WebCandle[] = [];
  for (let t = utc(9, 2); t <= utc(11, 11); t += DAY) {
    const c: WebCandle = { time: t / 1000, open: 90, high: 95, low: 85, close: 90, volume: 1 };
    if (t === utc(11, 4)) Object.assign(c, { high: 100, low: 80 });
    if (t === utc(10, 15)) Object.assign(c, { high: 120, low: 60 });
    if (t === utc(11, 1)) c.open = 85;
    out.push(c);
  }
  return out;
}

class Venue implements LevelVenuePort {
  now = 0;
  closes = new Map<number, number>();
  bars: Map<number, Partial<LevelBar>> = new Map();
  calls: Array<{ what: '15m' | '1d'; from?: number; limit?: number }> = [];
  daily15 = dailyCandles();
  fail15m = false;

  bar(open: number): LevelBar {
    const c = this.closes.get(open) ?? 92;
    return { openMs: open, open: c, high: c + 0.5, low: c - 0.5, close: c, ...(this.bars.get(open) ?? {}) };
  }

  async bars15m(_symbol: string, fromMs: number, limit: number): Promise<LevelBar[]> {
    this.calls.push({ what: '15m', from: fromMs, limit });
    if (this.fail15m) throw new Error('venue down');
    const out: LevelBar[] = [];
    for (let i = 0; i < limit; i++) {
      const open = fromMs + i * M;
      if (open + M <= this.now) out.push(this.bar(open));
    }
    return out;
  }

  async daily(_symbol: string, _dayStartMs: number): Promise<WebCandle[]> {
    this.calls.push({ what: '1d' });
    return this.daily15;
  }
}

type AlertRow = { id: number; event: string; symbol: string; direction: string; atMs: number; late: boolean; details: Record<string, unknown>; dedupeKey: string; firedAt: number | null; recipients: number };

class MemoryStore implements LevelAlertStore {
  settingsRow: LevelSettings = { enabled: false, membersVisible: false, params: LEVEL_DEFAULT_PARAMS, updatedAt: 0 };
  coins = [{ symbol: 'BTCUSDT', base: 'BTC' }];
  rows = new Map<string, LevelStateRow & { symbol: string }>();
  alerts: AlertRow[] = [];
  controls: Array<NewLevelControl & { id: number }> = [];
  paths: Array<{ subject: unknown; t0Sec: number }> = [];
  private id = 0;

  async settings() { return this.settingsRow; }
  async listedCoins() { return this.coins; }
  async states(_s: MarketAlertSource) { return new Map([...this.rows].map(([k, v]) => [k, { ...v, state: { ...v.state } }])); }
  async commit(x: LevelCommit) {
    const ids = x.alerts.map((a) => {
      if (this.alerts.some((r) => r.dedupeKey === a.dedupeKey)) return null;
      const id = ++this.id;
      this.alerts.push({ id, ...a, firedAt: null, recipients: 0 });
      return id;
    });
    for (const r of x.states) {
      this.rows.set(stateKey(x.symbol, r.kind, r.periodStartMs), { ...r, state: { ...r.state }, symbol: x.symbol });
      for (const [k, v] of this.rows) if (v.symbol === x.symbol && v.kind === r.kind && v.periodStartMs < r.periodStartMs) this.rows.delete(k);
    }
    return ids;
  }
  async insertControl(_s: MarketAlertSource, _b: string, _p: LevelParams, x: NewLevelControl) {
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
  row(kind: string, periodStartMs: number): LevelState | undefined { return this.rows.get(stateKey('BTCUSDT', kind as never, periodStartMs))?.state; }
}

function harness(store = new MemoryStore(), venue = new Venue()) {
  const sent: Array<[number, string]> = [];
  const loop = new LevelAlertLoop({
    store, venue, weightOf: klinesWeight, webBaseUrl: 'https://insight.example', build: 'dev', source: 'live',
    send: async (chatId, text) => { sent.push([chatId, text]); return true; },
  });
  const at = async (nowMs: number) => { venue.now = nowMs; return loop.tick(nowMs); };
  /** Evaluates the bar opening at `open` (and anything due before it). */
  const bar = (open: number) => at(evalAt(open));
  return { store, venue, loop, sent, at, bar };
}

const WEEK = utc(11, 9);
const MONTH = utc(11, 1);
const events = (s: MemoryStore) => s.alerts.map((a) => `${(a.details as { kind: string }).kind}:${a.event}`);

describe('IB-126 level alert loop', () => {
  it('dueBarOpen: the newest bar closed at least 5 s ago', () => {
    expect(dueBarOpen(T + M + 5_000)).toBe(T);
    expect(dueBarOpen(T + M + 4_999)).toBe(T - M);
  });

  it('go-live: one 15m read at limit 2 and the 1d read, then the coin is seeded in the same tick (P10) — weight measured', async () => {
    const h = harness();
    const r = await h.bar(T);
    expect(h.venue.calls[0]).toEqual({ what: '15m', from: T - M, limit: 2 });
    expect(h.venue.calls[1]).toEqual({ what: '1d' });
    // the seed: from the month start to the cursor bar, in pages of ≤ 1 500
    const seed = h.venue.calls.slice(2);
    expect(seed[0]).toEqual({ what: '15m', from: MONTH, limit: (T - MONTH) / M + 1 });
    expect(seed).toHaveLength(1); // 10.4 days = 1 001 bars, one page
    expect(r).toMatchObject({ bars: 1, seeded: ['BTCUSDT'], pendingSeed: 0, alerts: 0, calls: 3, weight: 1 + 1 + 10 });
    // four high/low rows (PDH/PDL off), every one at the cursor
    expect([...h.store.rows.values()].map((v) => `${v.kind}@${v.periodStartMs === WEEK ? 'week' : 'month'}`).sort()).toEqual(['PMH@month', 'PML@month', 'PWH@week', 'PWL@week']);
    expect(h.store.row('PWH', WEEK)).toEqual({ lastSide: 'below', firstBeyondAtMs: null, lastBarMs: T });
    expect(h.store.row('PWL', WEEK)).toEqual({ lastSide: 'above', firstBeyondAtMs: null, lastBarMs: T });
  });

  it('steady state: limit 2 at weight 1 per close, the 1d bars once a UTC day', async () => {
    const h = harness();
    await h.bar(T);
    h.venue.calls = [];
    const r = await h.bar(T + M);
    expect(h.venue.calls).toEqual([{ what: '15m', from: T, limit: 2 }]);
    expect(r).toMatchObject({ calls: 1, weight: 1, bars: 1 });
    // between closes: nothing read
    h.venue.calls = [];
    expect((await h.at(evalAt(T + M) + 60_000))?.calls).toBe(0);
    expect(h.venue.calls).toEqual([]);
    // the next UTC day: the 1d bars once more (the 23:45 bar is evaluated at 00:00:05, already the new day)
    await h.bar(utc(11, 12) - 2 * M);
    h.venue.calls = [];
    await h.bar(utc(11, 12) - M);
    await h.bar(utc(11, 12));
    expect(h.venue.calls.filter((c) => c.what === '1d')).toHaveLength(1);
  });

  it('a breakout of PWH is journalled with its facts and paths, and NOT sent while the switch is off', async () => {
    const h = harness();
    await h.bar(T);
    h.venue.closes.set(T + M, 101);
    const r = await h.bar(T + M);
    expect(r?.alerts).toBe(1);
    const a = h.store.alerts[0];
    expect(a).toMatchObject({ event: 'breakout_up', direction: 'bullish', atMs: T + M, late: false, dedupeKey: `level:BTCUSDT:PWH:${WEEK}:breakout_up`, firedAt: null });
    expect(LevelAlertDetailsSchema.parse(a.details)).toMatchObject({ kind: 'PWH', price: 100, periodStartMs: WEEK, prevClose: 92, firstBeyondAtMs: null });
    expect(h.store.paths).toContainEqual({ subject: { marketAlertId: a.id }, t0Sec: (T + 2 * M) / 1000 });
    expect(h.sent).toEqual([]);
    expect(h.store.row('PWH', WEEK)).toEqual({ lastSide: 'above', firstBeyondAtMs: T + 2 * M, lastBarMs: T + M });
  });

  it('with the switch on: sent to every recipient in their language, linking the bar\'s open on 15m', async () => {
    const h = harness();
    h.store.settingsRow = { ...h.store.settingsRow, enabled: true };
    await h.bar(T);
    h.venue.closes.set(T + M, 101);
    await h.bar(T + M);
    expect(h.sent.map(([c]) => c)).toEqual([7, 8]);
    expect(h.sent[0][1]).toBe(`BTC: пробой PWH 100.00 — 15m закрылась на 101.00\nhttps://insight.example/instrument/BTCUSDT?at=${(T + M) / 1000}&tf=15m`);
    expect(h.sent[1][1]).toContain('BTC: breakout above PWH 100.00 — 15m closed at 101.00');
    expect(h.store.alerts[0]).toMatchObject({ firedAt: evalAt(T + M), recipients: 2 });
  });

  it('crossunder after the breakout carries the first close above; a repeat breakout in the week is not journalled again', async () => {
    const h = harness();
    h.store.settingsRow = { ...h.store.settingsRow, enabled: true };
    await h.bar(T);
    for (const [i, c] of [[1, 101], [2, 99], [3, 101], [4, 98]] as const) {
      h.venue.closes.set(T + i * M, c);
      await h.bar(T + i * M);
    }
    expect(events(h.store)).toEqual(['PWH:breakout_up', 'PWH:crossunder']);
    expect(h.store.alerts[1].details).toMatchObject({ firstBeyondAtMs: T + 2 * M });
    expect(h.sent.filter(([c]) => c === 7).map(([, t]) => t.split('\n')[0])).toEqual([
      'BTC: пробой PWH 100.00 — 15m закрылась на 101.00',
      'BTC: возврат под PWH 100.00 — 15m закрылась на 99.00; выше уровня закрывалась с 11 ноя 10:30 UTC',
    ]);
  });

  it('a new ISO week: the same event is journalled again under its new period, and the old week\'s rows go', async () => {
    const h = harness();
    // Sunday 23:45: still last week's PWH (100)
    const sun = utc(11, 15, 23, 45);
    // the new week (11-16): its PWH is last week's high. Script the week of 11-09 so PWH = 100 again.
    h.venue.daily15 = [...dailyCandles(), ...[12, 13, 14, 15, 16].map((d) => ({ time: utc(11, d) / 1000, open: 90, high: d === 12 ? 100 : 95, low: 85, close: 90, volume: 1 }))];
    await h.bar(sun - M);
    h.venue.closes.set(sun, 101);
    await h.bar(sun);
    h.venue.closes.set(utc(11, 16), 99);
    h.venue.closes.set(utc(11, 16) + M, 101);
    await h.bar(utc(11, 16));
    await h.bar(utc(11, 16) + M);
    expect(h.store.alerts.filter((a) => a.event === 'breakout_up' && (a.details as { kind: string }).kind === 'PWH').map((a) => a.dedupeKey)).toEqual([
      `level:BTCUSDT:PWH:${WEEK}:breakout_up`, `level:BTCUSDT:PWH:${utc(11, 16)}:breakout_up`,
    ]);
    expect([...h.store.rows.values()].filter((r) => r.kind === 'PWH').map((r) => r.periodStartMs)).toEqual([utc(11, 16)]);
    // the new week's row started fresh at its first bar (no seed needed)
    expect(h.store.row('PWH', utc(11, 16))).toMatchObject({ lastSide: 'above', firstBeyondAtMs: utc(11, 16) + 2 * M });
  });

  it('state survives a restart: a NEW loop resumes from last_bar_at, steps the missed bars, and does not send a close older than 20 min', async () => {
    const store = new MemoryStore();
    store.settingsRow = { ...store.settingsRow, enabled: true };
    const venue = new Venue();
    const a = harness(store, venue);
    await a.bar(T);
    await a.bar(T + M);
    // down for an hour; meanwhile PWH broke and came back under
    venue.closes.set(T + 2 * M, 101);
    venue.closes.set(T + 5 * M, 99);
    const b = harness(store, venue);
    venue.calls = [];
    const r = await b.bar(T + 6 * M);
    expect(venue.calls[0]).toEqual({ what: '15m', from: T + M, limit: 6 });
    expect(r).toMatchObject({ bars: 5, seeded: [], pendingSeed: 0 });
    expect(store.alerts.map((x) => [x.event, x.late])).toEqual([['breakout_up', true], ['crossunder', true]]);
    expect(b.sent).toEqual([]);
    expect(store.alerts.every((x) => x.firedAt === null)).toBe(true);
    expect(store.row('PWH', WEEK)).toEqual({ lastSide: 'below', firstBeyondAtMs: T + 3 * M, lastBarMs: T + 6 * M });
  });

  it('a gap longer than the catch-up read is re-seeded, never stepped across', async () => {
    const h = harness();
    await h.bar(T);
    const later = T + (LEVEL_CATCHUP_BARS + 10) * M;
    h.venue.calls = [];
    const r = await harness(h.store, h.venue).bar(later);
    expect(h.venue.calls[0]).toEqual({ what: '15m', from: later - (LEVEL_CATCHUP_BARS - 1) * M, limit: LEVEL_CATCHUP_BARS });
    expect(r?.seeded).toEqual(['BTCUSDT']);
    expect(h.store.row('PWH', WEEK)?.lastBarMs).toBe(later);
  });

  it('an unseeded coin: no crossunder, breakouts still fire; seeding is one coin per tick', async () => {
    const h = harness();
    h.store.coins = [{ symbol: 'AAAUSDT', base: 'AAA' }, { symbol: 'BTCUSDT', base: 'BTC' }];
    const r1 = await h.bar(T);
    expect(r1).toMatchObject({ seeded: ['AAAUSDT'], pendingSeed: 1 });
    const r2 = await h.at(evalAt(T) + 60_000);
    expect(r2).toMatchObject({ seeded: ['BTCUSDT'], pendingSeed: 0, bars: 0 });
  });

  it('the unseeded side in isolation: a close back under PWH with no state is not a crossunder', async () => {
    const h = harness();
    h.store.coins = [{ symbol: 'AAAUSDT', base: 'AAA' }, { symbol: 'BTCUSDT', base: 'BTC' }];
    h.venue.closes.set(T - M, 101);
    h.venue.closes.set(T, 99);
    await h.bar(T); // AAA seeded first; BTC's T bar was stepped unseeded
    expect(h.store.alerts.filter((a) => a.symbol === 'BTCUSDT' && a.event === 'crossunder')).toEqual([]);
    expect(h.store.alerts.filter((a) => a.symbol === 'AAAUSDT').map((a) => a.event)).toEqual([]); // seeded rows emit nothing
  });

  it('P2: PDH/PDL only for a coin with daily on; an event switched off is not journalled while its sibling is', async () => {
    const h = harness();
    h.store.settingsRow = { ...h.store.settingsRow, params: { ...LEVEL_DEFAULT_PARAMS, perCoin: { BTCUSDT: { enabled: true, daily: true } }, events: { PWH: { breakout_up: false } } } };
    await h.bar(T);
    expect(h.store.row('PDH', utc(11, 11))).toBeDefined();
    h.venue.closes.set(T + M, 101);
    await h.bar(T + M);
    expect(events(h.store)).toEqual(['PDH:breakout_up']);
  });

  it('a coin switched off is not read at all', async () => {
    const h = harness();
    h.store.settingsRow = { ...h.store.settingsRow, params: { ...LEVEL_DEFAULT_PARAMS, perCoin: { BTCUSDT: { enabled: false, daily: false } } } };
    expect(await h.bar(T)).toMatchObject({ coins: 0, calls: 0 });
    expect(coinsOf([{ symbol: 'X1USDT', base: 'X1' }], LEVEL_DEFAULT_PARAMS)).toEqual([{ symbol: 'X1USDT', base: 'X1', daily: false }]);
  });

  it('opens: up through the weekly open, then back down — two messages, directions as closed', async () => {
    const h = harness();
    h.venue.closes.set(T - M, 89);
    h.venue.closes.set(T, 89);
    await h.bar(T);
    h.venue.closes.set(T + M, 91);
    await h.bar(T + M);
    h.venue.closes.set(T + 2 * M, 89.5);
    await h.bar(T + 2 * M);
    expect(events(h.store)).toEqual(['WO:breakout_up', 'WO:breakout_down']);
    expect(h.store.alerts.map((a) => a.direction)).toEqual(['bullish', 'bearish']);
  });

  it('P7: a touch once per level and UTC day; 2 random bars a coin and day, with the levels in force', async () => {
    const h = harness();
    h.venue.bars.set(T + M, { high: 99.95 });
    h.venue.bars.set(T + 2 * M, { high: 99.98 });
    await h.bar(T);
    await h.bar(T + M);
    await h.bar(T + 2 * M);
    const touches = h.store.controls.filter((c) => c.kind === 'touch');
    expect(touches.map((c) => c.dedupeKey)).toEqual([`level-touch:BTCUSDT:PWH:${WEEK}:2026-11-11`]);
    expect(LevelTouchDetailsSchema.parse(touches[0].details)).toMatchObject({ kind: 'PWH', from: 'below', touchBand: 0.001 });
    // random: play the whole day
    const day = utc(11, 11);
    const picks = randomBarOpens('BTCUSDT', day);
    const h2 = harness();
    h2.venue.now = 0;
    await h2.bar(day);
    for (let o = day + M; o < day + DAY; o += M) await h2.bar(o);
    const rnd = h2.store.controls.filter((c) => c.kind === 'random');
    expect(rnd.map((c) => c.atMs)).toEqual(picks.filter((p) => p >= day + M || p === day));
    expect(LevelRandomDetailsSchema.parse(rnd[0].details).levels.map((l) => l.kind)).toEqual(['PWH', 'PWL', 'PMH', 'PML', 'WO', 'MO']);
    expect(h2.store.paths.some((p) => (p.subject as { marketControlId?: number }).marketControlId === rnd[0].id)).toBe(true);
  });

  it('a venue failure for one coin is reported and retried at the next tick, the cursor unmoved', async () => {
    const h = harness();
    await h.bar(T);
    h.venue.fail15m = true;
    expect((await h.bar(T + M))?.failed).toEqual(['BTCUSDT']);
    h.venue.fail15m = false;
    h.venue.calls = [];
    const r = await h.at(evalAt(T + M) + 60_000);
    expect(h.venue.calls[0]).toEqual({ what: '15m', from: T, limit: 2 });
    expect(r?.bars).toBe(1);
  });

  it('a stale 1d copy never vouches for a period that started after it was read', async () => {
    const h = harness();
    await h.bar(utc(11, 11, 23, 30));
    // midnight: the 1d refresh fails; the old copy (read on 11-11) cannot give 11-12's PDH, nor anything new
    h.venue.daily = async () => { throw new Error('1d down'); };
    h.store.settingsRow = { ...h.store.settingsRow, params: { ...LEVEL_DEFAULT_PARAMS, perCoin: { BTCUSDT: { enabled: true, daily: true } } } };
    h.venue.closes.set(utc(11, 12), 96);
    await h.bar(utc(11, 11, 23, 45));
    await h.bar(utc(11, 12));
    expect(events(h.store)).toEqual([]); // 96 > 11-11's high 95 would have been a PDH breakout
  });
});
