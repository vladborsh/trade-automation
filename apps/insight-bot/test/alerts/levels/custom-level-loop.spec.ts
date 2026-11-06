import {
  LEVEL_DEFAULT_PARAMS, type LevelBar, type LevelParams, type MarketAlertSource, type WebCandle,
} from '@trade-automation/contracts';
import { LevelAlertLoop, type CustomLevelPort, type LevelVenuePort } from '../../../src/alerts/levels/level-alert-loop';
import type { CustomLevel } from '../../../src/alerts/levels/pg/custom-levels.repo';
import { stateKey, type LevelAlertStore, type LevelCommit, type LevelSettings, type LevelStateRow, type NewLevelControl } from '../../../src/alerts/levels/pg/level-alerts.repo';
import { klinesWeight } from '../../../src/news/reaction-prices';

/**
 * IB-128 (design §4 P9) — custom levels inside the level loop: evaluated on the same 15m read (no extra venue call),
 * committed with the built-in levels' alerts, once per (level, event, UTC day), a deleted level silent from the next
 * tick, sent only to admins and only while the level type's switch is on.
 *
 * Built-in levels around 90 (weekly open 90, monthly open 85, PWH 100 …) are far from the custom level at 200, so
 * every alert below is the custom level's.
 */
const M = 900_000;
const DAY = 86_400_000;
const utc = (m: number, d: number, h = 0, min = 0) => Date.UTC(2026, m - 1, d, h, min);
const T = utc(11, 11, 10);
const evalAt = (open: number) => open + M + 5_000;

class Venue implements LevelVenuePort {
  now = 0;
  closes = new Map<number, number>();
  calls = 0;
  bar(open: number): LevelBar {
    const c = this.closes.get(open) ?? 190;
    return { openMs: open, open: c, high: c + 0.5, low: c - 0.5, close: c };
  }
  async bars15m(_s: string, fromMs: number, limit: number): Promise<LevelBar[]> {
    this.calls++;
    const out: LevelBar[] = [];
    for (let i = 0; i < limit; i++) if (fromMs + (i + 1) * M <= this.now) out.push(this.bar(fromMs + i * M));
    return out;
  }
  async daily(): Promise<WebCandle[]> {
    this.calls++;
    const out: WebCandle[] = [];
    for (let t = utc(9, 2); t <= utc(11, 11); t += DAY) out.push({ time: t / 1000, open: 90, high: 95, low: 85, close: 90, volume: 1 });
    return out;
  }
}

class Store implements LevelAlertStore {
  settingsRow: LevelSettings = { enabled: false, membersVisible: false, params: LEVEL_DEFAULT_PARAMS, updatedAt: 0 };
  rows = new Map<string, LevelStateRow & { symbol: string }>();
  alerts: Array<{ id: number; event: string; dedupeKey: string; details: Record<string, unknown>; late: boolean; firedAt: number | null; recipients: number; mutedBy: string | null }> = [];
  commits: LevelCommit[] = [];
  private id = 0;
  async settings() { return this.settingsRow; }
  async listedCoins() { return [{ symbol: 'BTCUSDT', base: 'BTC' }]; }
  async states(_s: MarketAlertSource) { return new Map(this.rows); }
  async commit(x: LevelCommit) {
    this.commits.push(x);
    for (const r of x.states) this.rows.set(stateKey(x.symbol, r.kind, r.periodStartMs), { ...r, symbol: x.symbol });
    return x.alerts.map((a) => {
      if (this.alerts.some((r) => r.dedupeKey === a.dedupeKey)) return null;
      const id = ++this.id;
      this.alerts.push({ id, event: a.event, dedupeKey: a.dedupeKey, details: a.details, late: a.late, firedAt: null, recipients: 0, mutedBy: a.mutedBy ?? null });
      return id;
    });
  }
  async insertControl(_s: MarketAlertSource, _b: string, _p: LevelParams, _x: NewLevelControl) { return null; }
  async insertPaths() {}
  /** The level type's recipients: an admin (7) and a member (8). */
  async recipients() { return [{ chatId: 7, lang: 'ru' as const }, { chatId: 8, lang: 'en' as const }]; }
  async markFired(id: number, at: number, n: number) {
    const r = this.alerts.find((a) => a.id === id);
    if (r) { r.firedAt = at; r.recipients = n; }
  }
}

class Custom implements CustomLevelPort {
  levels: CustomLevel[] = [{ id: 7, symbol: 'BTCUSDT', price: 200, note: 'range high', events: {}, createdBy: 1, createdAtMs: utc(11, 1) }];
  reads = 0;
  async active() { this.reads++; return this.levels; }
  /** Admins only: 7. */
  async recipients() { return [{ chatId: 7, lang: 'ru' as const }]; }
}

function harness(custom: Custom | null = new Custom()) {
  const store = new Store();
  const venue = new Venue();
  const sent: Array<[number, string]> = [];
  const loop = new LevelAlertLoop({
    store, venue, weightOf: klinesWeight, webBaseUrl: 'https://insight.example', build: 'dev', source: 'live',
    send: async (chatId, text) => { sent.push([chatId, text]); return true; },
    ...(custom ? { custom } : {}),
  });
  const bar = async (open: number) => { venue.now = evalAt(open); return loop.tick(evalAt(open)); };
  return { store, venue, sent, loop, bar, custom };
}

/** The custom rows no switch muted (all of them, before IB-151); `mutedCustom` the others. */
const customAlerts = (s: Store) => s.alerts.filter((a) => a.details.kind === 'custom' && a.mutedBy === null);
const mutedCustom = (s: Store) => s.alerts.filter((a) => a.details.kind === 'custom' && a.mutedBy !== null);

describe('IB-128 custom levels in the level loop', () => {
  it('a breakout up of the custom level: journalled from the same read, no extra venue call, in the bar\'s one commit', async () => {
    const h = harness();
    await h.bar(T - M);
    const callsBefore = h.venue.calls;
    h.venue.closes.set(T, 201);
    const r = await h.bar(T);
    expect(h.venue.calls - callsBefore).toBe(1); // the one 15m read
    expect(customAlerts(h.store).map((a) => a.event)).toEqual(['breakout_up']);
    expect(r?.alerts).toBe(1);
    expect(h.store.commits.at(-1)?.alerts.map((a) => a.event)).toEqual(['breakout_up']);
    expect(h.store.commits.at(-1)?.states.length).toBeGreaterThan(0);
  });

  it('sending OFF (the default): journalled, nothing sent', async () => {
    const h = harness();
    await h.bar(T - M);
    h.venue.closes.set(T, 201);
    await h.bar(T);
    expect(h.sent).toEqual([]);
    expect(customAlerts(h.store)[0].firedAt).toBeNull();
  });

  it('sending ON: to the ADMINS (custom.recipients), not to the level type\'s member recipients', async () => {
    const h = harness();
    h.store.settingsRow = { ...h.store.settingsRow, enabled: true };
    await h.bar(T - M);
    h.venue.closes.set(T, 201);
    await h.bar(T);
    expect(h.sent.map(([id]) => id)).toEqual([7]);
    expect(h.sent[0][1]).toBe(`BTC: пробой вверх своего уровня 200.00 (range high) — 15m закрылась на 201.00\nhttps://insight.example/instrument/BTCUSDT?at=${T / 1000}&tf=15m`);
    expect(customAlerts(h.store)[0]).toMatchObject({ recipients: 1 });
  });

  it('P9: chop around the level gives at most one per (level, event) in a UTC day; the next day may speak again', async () => {
    const h = harness();
    const closes = [199, 201, 199, 201, 199, 201];
    const start = utc(11, 11, 22, 30);
    await h.bar(start - M);
    for (const [i, c] of closes.entries()) { h.venue.closes.set(start + i * M, c); await h.bar(start + i * M); }
    // 22:30 … 23:45: three breakouts up and two down on 11-11 → one of each
    expect(customAlerts(h.store).map((a) => a.event)).toEqual(['breakout_up', 'breakout_down']);
    // 11-12 00:00 opens below, then a breakout up again: a new day's key
    h.venue.closes.set(start + 6 * M, 199);
    h.venue.closes.set(start + 7 * M, 201);
    await h.bar(start + 6 * M);
    await h.bar(start + 7 * M);
    expect(customAlerts(h.store).map((a) => a.event)).toEqual(['breakout_up', 'breakout_down', 'breakout_down', 'breakout_up']);
  });

  it('a deleted level does not fire: the loop reads the active ones every evaluating tick', async () => {
    const h = harness();
    await h.bar(T - M);
    h.custom!.levels = [];
    h.venue.closes.set(T, 201);
    await h.bar(T);
    expect(customAlerts(h.store)).toEqual([]);
    expect(h.custom!.reads).toBe(2);
  });

  it('the level\'s own switch: breakout up off, so the breakout is silent (journalled muted, IB-151) and the sweep is not', async () => {
    const h = harness();
    h.store.settingsRow = { ...h.store.settingsRow, enabled: true };
    h.custom!.levels = [{ ...h.custom!.levels[0], events: { breakout_up: false } }];
    await h.bar(T - M);
    h.venue.closes.set(T, 201);
    await h.bar(T);
    expect(customAlerts(h.store)).toEqual([]);
    expect(h.sent).toEqual([]);
    expect(mutedCustom(h.store).map((a) => [a.event, a.mutedBy, a.firedAt, a.dedupeKey])).toEqual([['breakout_up', 'custom_event', null, `level:BTCUSDT:custom-7:${utc(11, 11)}:breakout_up:muted`]]);
    // back below (a breakout down, on), then a wick through to 200.3 closing at 199.8: the sweep above, on
    h.venue.closes.set(T + M, 199);
    h.venue.closes.set(T + 2 * M, 199.8);
    await h.bar(T + M);
    await h.bar(T + 2 * M);
    expect(customAlerts(h.store).map((a) => a.event)).toEqual(['breakout_down', 'sweep_above']);
  });

  it('the coin switched off for levels: its custom levels are muted too — journalled by the coin, never sent (IB-151)', async () => {
    const h = harness();
    h.store.settingsRow = { ...h.store.settingsRow, enabled: true, params: { ...LEVEL_DEFAULT_PARAMS, perCoin: { BTCUSDT: { enabled: false, daily: false } } } };
    h.custom!.levels = [{ ...h.custom!.levels[0], events: { sweep_above: false } }];
    await h.bar(T - M);
    h.venue.closes.set(T, 201);
    await h.bar(T);
    h.venue.closes.set(T + M, 199);
    h.venue.closes.set(T + 2 * M, 199.8);
    await h.bar(T + M);
    await h.bar(T + 2 * M);
    expect(customAlerts(h.store)).toEqual([]);
    expect(h.sent).toEqual([]);
    // the coin is named, not the level's own switch, and the key is muted once
    expect(mutedCustom(h.store).map((a) => [a.event, a.mutedBy, a.dedupeKey.endsWith(':muted') && !a.dedupeKey.endsWith(':muted:muted')]))
      .toEqual([['breakout_up', 'coin', true], ['breakout_down', 'coin', true], ['sweep_above', 'coin', true]]);
  });

  it('no custom port (the history run): no custom alerts, the built-in levels as before', async () => {
    const h = harness(null);
    await h.bar(T - M);
    h.venue.closes.set(T, 201);
    await h.bar(T);
    expect(customAlerts(h.store)).toEqual([]);
  });

  it('a late bar (after downtime) is journalled late and never sent', async () => {
    const h = harness();
    h.store.settingsRow = { ...h.store.settingsRow, enabled: true };
    await h.bar(T - M);
    h.venue.closes.set(T, 201);
    h.venue.now = evalAt(T) + 30 * 60_000;
    await h.loop.tick(h.venue.now);
    // the catch-up read steps 10:00 (up through the level; its close 35 min old: late, not sent) and 10:15 (back down at
    // 190; its close 15 min old, under the 20-min bound: sent)
    expect(customAlerts(h.store).map((a) => [a.event, a.late, a.firedAt !== null])).toEqual([['breakout_up', true, false], ['breakout_down', false, true]]);
    expect(h.sent.map(([, text]) => text.split('\n')[0])).toEqual(['BTC: пробой вниз своего уровня 200.00 (range high) — 15m закрылась на 190.00']);
  });
});
