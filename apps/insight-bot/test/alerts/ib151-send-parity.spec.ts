import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FUNDING_DEFAULT_PARAMS, LEVEL_DEFAULT_PARAMS, LIQ_DEFAULT_PARAMS, levelKindEvents, type FundingParams, type LevelBar, type LevelParams, type LiqParams,
  type LiqSide, type LiqVenue, type MarketAlertSource, type WebCandle,
} from '@trade-automation/contracts';
import { FundingAlertLoop, type FundingVenuePort } from '../../src/alerts/funding/funding-alert-loop';
import type { FundingSideState } from '../../src/alerts/funding/funding-state';
import type { FundingAlertStore, FundingCommit, FundingSettings, NewFundingControl } from '../../src/alerts/funding/pg/funding-alerts.repo';
import { HistoryLevelVenue } from '../../src/alerts/levels/backfill/level-history';
import { LevelAlertLoop, type CustomLevelPort } from '../../src/alerts/levels/level-alert-loop';
import type { CustomLevel } from '../../src/alerts/levels/pg/custom-levels.repo';
import { stateKey, type LevelAlertStore, type LevelCommit, type LevelSettings, type LevelStateRow, type NewLevelControl } from '../../src/alerts/levels/pg/level-alerts.repo';
import { LiqAlertLoop } from '../../src/alerts/liquidations/liq-alert-loop';
import { klinesWeight } from '../../src/news/reaction-prices';
import { MemoryLiqStore } from './liquidations/memory-liq-store';

/**
 * IB-151 (owner ruling 2026-11-06 B) — the invariant, over the shipped loops: **for every switch setting, what is SENT
 * is byte-identical to before IB-151, and the journal only gains the rows that were skipped.**
 *
 * Each scenario runs one live loop (`source = 'live'`, sending ON) through its own `tick`, with the real builders and
 * texts, an in-memory journal with migration 031's once-keys and a recording sender:
 * - liquidations: the box tape of IB-148 (11-04 short, 11-05 long; every coin), each coin switched off in turn;
 * - levels: real Binance 15m and 1d bars of the five coins (`level-bars-5-coins-2026-11-01.json`, fetched 2026-11-06),
 *   replayed minute by minute 11-03 00:00 → 11-06 18:00 with custom levels; the box's switches (WO off), and others;
 * - funding: a scripted rate per coin (an extreme, a flip, a near-miss) over three days at 5 min.
 *
 * **The "before" is master's code, not a re-implementation:** `ib151-sends-master.json` was written by THIS file run
 * on origin/master (2caab2e4) with `IB151_RECORD=<path>`: each scenario's sends (time, chat, a hash of the text and
 * its first line) and its journal's once-keys. On the branch the spec asserts, per scenario:
 * 1. the sends equal master's, hash for hash;
 * 2. the unmuted rows are master's rows, key for key;
 * 3. every muted row is one master skipped: its key without `:muted` is not among master's, and is among the keys of
 *    the same run with every switch ON (`*-all-on`), so muting skips nothing and invents nothing.
 */
const RECORD = process.env.IB151_RECORD;
const FIXTURE = join(__dirname, '../fixtures/ib151-sends-master.json');
const S = 1_000;
const MIN = 60 * S;
const BAR = 15 * MIN;
const DAY = 86_400_000;
const COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'TRX'].map((b) => ({ symbol: `${b}USDT`, base: b }));

type Send = [at: string, chatId: number, textHash: string, firstLine: string];
interface Outcome { sends: Send[]; keys: string[] }
interface Run extends Outcome { muted: Array<{ key: string; by: string }> }

const hash = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 16);
const send = (at: number, chatId: number, text: string): Send => [new Date(at).toISOString(), chatId, hash(text), text.split('\n')[0] as string];
/** A row's switch, read without the type that names it (master's rows have none). */
const mutedOf = (row: object): string | undefined => (row as { mutedBy?: string }).mutedBy;
const outcome = (sends: Send[], rows: ReadonlyArray<{ dedupeKey: string }>): Run => ({
  sends,
  keys: rows.filter((r) => mutedOf(r) === undefined).map((r) => r.dedupeKey),
  muted: rows.filter((r) => mutedOf(r) !== undefined).map((r) => ({ key: r.dedupeKey, by: mutedOf(r) as string })),
});

// ------------------------------------------------------------------------------------------------ liquidations

function loadTape(file: string, side: LiqSide) {
  const f = JSON.parse(readFileSync(join(__dirname, '../fixtures', file), 'utf8')) as { baseMs: number; rows: Array<[number, LiqVenue, string, number]> };
  return f.rows.map(([o, venue, symbol, usd]) => ({ venue, symbol, side, ts: f.baseMs + o, usd }));
}

async function liqRun(file: string, side: LiqSide, fromMs: number, toMs: number, params: LiqParams): Promise<Run> {
  const bases = COINS.map((c) => c.base);
  const store = new MemoryLiqStore();
  store.coins = COINS.map((c) => ({ ...c }));
  store.params = params;
  store.enabled = true;
  // both languages (the store's own field is typed for one)
  (store as unknown as { users: Array<{ chatId: number; lang: 'ru' | 'en' }> }).users = [{ chatId: 7, lang: 'ru' }, { chatId: 8, lang: 'en' }];
  store.status = {
    ...MemoryLiqStore.allAlive(),
    tracked: new Map([['bybit', new Map(bases.map((b) => [`${b}USDT`, 0]))], ['okx', new Map(bases.map((b) => [`${b}-USDT-SWAP`, 0]))]]),
  };
  store.tape = loadTape(file, side);
  let now = 0;
  const sends: Send[] = [];
  const loop = new LiqAlertLoop({
    store, universe: bases.map((b) => ({ id: `${b}USDT`, base: b, binance_perp: `${b}USDT`, bybit_linear: `${b}USDT`, okx_swap: `${b}-USDT-SWAP` })),
    webBaseUrl: 'https://insight.example', build: 'dev', source: 'live', send: async (chatId, text) => (sends.push(send(now, chatId, text)), true),
  });
  for (now = fromMs; now <= toMs; now += 10 * S) {
    const r = await loop.tick(now);
    if (r && r.failed.length > 0) throw new Error(`liq tick ${new Date(now).toISOString()} failed: ${r.failed.join(', ')}`);
  }
  return outcome(sends, store.alerts);
}

const liqOff = (...symbols: string[]): LiqParams => ({
  perCoin: Object.fromEntries(Object.entries(LIQ_DEFAULT_PARAMS.perCoin).map(([s, p]) => [s, symbols.includes(s) ? { ...p, enabled: false } : p])),
});
const LIQ_TAPES = {
  'short-11-04': ['liq-all-short-2026-11-04.json', 'short', Date.UTC(2026, 10, 4, 14, 36), Date.UTC(2026, 10, 4, 14, 53)],
  'long-11-05': ['liq-all-long-2026-11-05.json', 'long', Date.UTC(2026, 10, 5, 14, 31), Date.UTC(2026, 10, 5, 15, 21)],
} as const;
const LIQ_SWITCHES: Record<string, LiqParams> = {
  'all-on': LIQ_DEFAULT_PARAMS,
  ...Object.fromEntries(COINS.map((c) => [`${c.base}-off`, liqOff(c.symbol)])),
  'BTC+ETH-off': liqOff('BTCUSDT', 'ETHUSDT'),
};

// ------------------------------------------------------------------------------------------------ levels

const LEVEL_FROM = Date.UTC(2026, 10, 3);
const LEVEL_TO = Date.UTC(2026, 10, 6, 18);

function levelVenue(): HistoryLevelVenue {
  const f = JSON.parse(readFileSync(join(__dirname, '../fixtures/level-bars-5-coins-2026-11-01.json'), 'utf8')) as {
    from15m: number; bars15m: Record<string, Array<[number, number, number, number, number]>>; daily: Record<string, Array<[number, number, number, number, number]>>;
  };
  const bars = new Map<string, LevelBar[]>();
  const daily = new Map<string, WebCandle[]>();
  for (const [s, rows] of Object.entries(f.bars15m)) bars.set(s, rows.map(([i, open, high, low, close]) => ({ openMs: f.from15m + i * BAR, open, high, low, close })));
  for (const [s, rows] of Object.entries(f.daily)) daily.set(s, rows.map(([time, open, high, low, close]) => ({ time, open, high, low, close, volume: 0 })));
  return new HistoryLevelVenue(bars, daily);
}

class LevelMemory implements LevelAlertStore {
  rows = new Map<string, LevelStateRow & { symbol: string }>();
  journal: Array<{ id: number; dedupeKey: string }> = [];
  private id = 0;
  constructor(private readonly settingsRow: LevelSettings) {}
  async settings() { return this.settingsRow; }
  async listedCoins() { return COINS.map((c) => ({ ...c })); }
  async states(_s: MarketAlertSource) { return new Map([...this.rows].map(([k, v]) => [k, { ...v, state: { ...v.state } }])); }
  async commit(x: LevelCommit) {
    const ids = x.alerts.map((a) => {
      if (this.journal.some((r) => r.dedupeKey === a.dedupeKey)) return null;
      this.journal.push({ ...a, id: ++this.id });
      return this.id;
    });
    for (const r of x.states) {
      for (const [k, v] of this.rows) if (v.symbol === x.symbol && v.kind === r.kind && v.periodStartMs < r.periodStartMs) this.rows.delete(k);
      this.rows.set(stateKey(x.symbol, r.kind, r.periodStartMs), { ...r, state: { ...r.state }, symbol: x.symbol });
    }
    return ids;
  }
  async insertControl(_s: MarketAlertSource, _b: string, _p: LevelParams, _x: NewLevelControl) { return null; }
  async insertPaths() {}
  async recipients() { return [{ chatId: 7, lang: 'ru' as const }, { chatId: 8, lang: 'en' as const }]; }
  async markFired() {}
}

/** Custom levels near the window's first prices, one with an event switched off (IB-128's own switch). */
function customLevels(): CustomLevelPort {
  const f = JSON.parse(readFileSync(join(__dirname, '../fixtures/level-bars-5-coins-2026-11-01.json'), 'utf8')) as {
    from15m: number; bars15m: Record<string, Array<[number, number, number, number, number]>>;
  };
  const closeAt = (s: string) => ((f.bars15m[s] ?? []).find(([i]) => f.from15m + i * BAR === LEVEL_FROM - BAR) as [number, number, number, number, number])[4];
  const at = LEVEL_FROM - DAY;
  const levels: CustomLevel[] = [
    { id: 1, symbol: 'BTCUSDT', price: Math.round(closeAt('BTCUSDT') * 1.01), note: 'above', events: {}, createdBy: 1, createdAtMs: at },
    { id: 2, symbol: 'BTCUSDT', price: Math.round(closeAt('BTCUSDT') * 0.99), note: 'below', events: { breakout_down: false }, createdBy: 1, createdAtMs: at },
    { id: 3, symbol: 'SOLUSDT', price: Number((closeAt('SOLUSDT') * 1.02).toFixed(2)), note: null, events: {}, createdBy: 1, createdAtMs: at },
  ];
  return { active: async () => levels, recipients: async () => [{ chatId: 7, lang: 'ru' as const }] };
}

async function levelRun(params: LevelParams): Promise<Run> {
  const store = new LevelMemory({ enabled: true, membersVisible: false, params, updatedAt: 0 });
  const venue = levelVenue();
  const custom = customLevels();
  let now = 0;
  const sends: Send[] = [];
  const loop = new LevelAlertLoop({
    store, venue, weightOf: klinesWeight, webBaseUrl: 'https://insight.example', build: 'dev', source: 'live', custom,
    send: async (chatId, text) => (sends.push(send(now, chatId, text)), true),
  });
  for (now = LEVEL_FROM + BAR + 5 * S; now <= LEVEL_TO + 5 * S; now += MIN) {
    venue.now = now;
    const r = await loop.tick(now);
    if (r && r.failed.length > 0) throw new Error(`level tick ${new Date(now).toISOString()} failed: ${r.failed.join(', ')}`);
  }
  return outcome(sends, store.journal);
}

const allOff = (kind: 'WO' | 'MO') => ({ [kind]: Object.fromEntries(levelKindEvents(kind).map((e) => [e, false])) });
const LEVEL_SWITCHES: Record<string, LevelParams> = {
  /** As on the box since 2026-11-06 13:06:05Z: levels on, the weekly open's events off, PDH/PDL off. */
  'box-WO-off': { ...LEVEL_DEFAULT_PARAMS, events: allOff('WO') },
  defaults: LEVEL_DEFAULT_PARAMS,
  'daily-BTC-ETH,PWH-breakout_up-off': {
    ...LEVEL_DEFAULT_PARAMS, events: { PWH: { breakout_up: false } }, perCoin: { BTCUSDT: { enabled: true, daily: true }, ETHUSDT: { enabled: true, daily: true } },
  },
  'SOL+TRX-off,MO-off': { ...LEVEL_DEFAULT_PARAMS, events: allOff('MO'), perCoin: { SOLUSDT: { enabled: false, daily: true }, TRXUSDT: { enabled: false, daily: false } } },
  'all-on': { ...LEVEL_DEFAULT_PARAMS, perCoin: Object.fromEntries(COINS.map((c) => [c.symbol, { enabled: true, daily: true }])) },
};

// ------------------------------------------------------------------------------------------------ funding

const F0 = Date.UTC(2026, 10, 3);
const F_STEP = 5 * MIN;
const F_TICKS = 3 * 288;
/** A month of ordinary 8 h settlements around +0.01 %, as the funding loop spec's. */
const F_HISTORY = Array.from({ length: 90 }, (_, i) => ({ time: Math.floor(F0 / 1000) - (90 - i) * 8 * 3600, rate: [0.0001, 0.00005, 0.00015, 0.00008, 0.00012][i % 5] as number }));
/** Per coin and tick: BTC 25 h extreme high then a flip; ETH 3 h extreme low; SOL a near-miss; BNB, TRX ordinary. */
function rateAt(symbol: string, i: number): number {
  if (symbol === 'BTCUSDT') return i >= 12 && i < 12 + 300 ? 0.0005 : i >= 312 && i < 330 ? -0.0001 : 0.0001;
  if (symbol === 'ETHUSDT') return i >= 400 && i < 436 ? -0.0006 : 0.0001;
  if (symbol === 'SOLUSDT') return i >= 600 && i < 610 ? 0.00025 : 0.0001;
  return 0.0001;
}

class FundingMemory implements FundingAlertStore {
  rows = new Map<string, FundingSideState>();
  journal: Array<{ id: number; dedupeKey: string }> = [];
  private id = 0;
  constructor(private readonly settingsRow: FundingSettings) {}
  async settings() { return this.settingsRow; }
  async listedCoins() { return COINS.map((c) => ({ ...c })); }
  async states(_s: MarketAlertSource) { return new Map([...this.rows].map(([k, v]) => [k, { ...v }])); }
  async commit(x: FundingCommit) {
    const ids = x.alerts.map((a) => {
      if (this.journal.some((r) => r.dedupeKey === a.dedupeKey)) return null;
      this.journal.push({ ...a, id: ++this.id });
      return this.id;
    });
    for (const s of x.states) this.rows.set(`${x.symbol}|${s.side}`, { ...s.state });
    return ids;
  }
  async insertControl(_s: MarketAlertSource, _b: string, _p: FundingParams, _x: NewFundingControl) { return null; }
  async insertPaths() {}
  async recipients() { return [{ chatId: 7, lang: 'ru' as const }, { chatId: 8, lang: 'en' as const }]; }
  async markFired() {}
}

async function fundingRun(params: FundingParams): Promise<Run> {
  const store = new FundingMemory({ enabled: true, membersVisible: false, params, updatedAt: 0 });
  let i = 0;
  let now = F0;
  const venue: FundingVenuePort = {
    premiumIndex: async (symbol) => ({ rate: rateAt(symbol, i), timeMs: now - S, nextFundingTimeMs: now + 3_600_000 }),
    settled: async () => F_HISTORY,
  };
  const sends: Send[] = [];
  const loop = new FundingAlertLoop({
    store, venue, webBaseUrl: 'https://insight.example', build: 'dev', source: 'live', send: async (chatId, text) => (sends.push(send(now, chatId, text)), true),
  });
  for (i = 0; i < F_TICKS; i++) {
    now = F0 + i * F_STEP;
    const r = await loop.tick(now);
    if (r && r.failed.length > 0) throw new Error(`funding tick ${i} failed: ${r.failed.join(', ')}`);
  }
  return outcome(sends, store.journal);
}

const FUNDING_SWITCHES: Record<string, FundingParams> = {
  'all-on': FUNDING_DEFAULT_PARAMS,
  'BTC-off': { ...FUNDING_DEFAULT_PARAMS, perCoin: { BTCUSDT: { enabled: false } } },
  'ETH+SOL-off': { ...FUNDING_DEFAULT_PARAMS, perCoin: { ETHUSDT: { enabled: false }, SOLUSDT: { enabled: false } } },
};

// ------------------------------------------------------------------------------------------------ the runs

const SCENARIOS: Array<[name: string, run: () => Promise<Run>]> = [
  ...Object.entries(LIQ_TAPES).flatMap(([tape, [file, side, from, to]]) =>
    Object.entries(LIQ_SWITCHES).map(([sw, p]) => [`liq:${tape}:${sw}`, () => liqRun(file, side, from, to, p)] as [string, () => Promise<Run>])),
  ...Object.entries(LEVEL_SWITCHES).map(([sw, p]) => [`level:${sw}`, () => levelRun(p)] as [string, () => Promise<Run>]),
  ...Object.entries(FUNDING_SWITCHES).map(([sw, p]) => [`funding:${sw}`, () => fundingRun(p)] as [string, () => Promise<Run>]),
];
const allOnOf = (name: string) => name.replace(/:[^:]+$/, ':all-on');

describe('IB-151: what is sent is master\'s, for every switch set; the journal only gains what master skipped', () => {
  const runs = new Map<string, Run>();
  beforeAll(async () => {
    for (const [name, run] of SCENARIOS) runs.set(name, await run());
    if (RECORD) {
      const out: Record<string, Outcome> = {};
      for (const [name, r] of runs) out[name] = { sends: r.sends, keys: r.keys };
      writeFileSync(RECORD, `${JSON.stringify({ recordedFrom: process.env.IB151_RECORDED_FROM ?? 'unknown', scenarios: out }, null, 1)}\n`);
    }
  }, 300_000);

  const master = (): Record<string, Outcome> => (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { scenarios: Record<string, Outcome> }).scenarios;

  it('the fixture was recorded from master and covers every scenario; master journalled nothing muted', () => {
    if (RECORD) return;
    const f = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { recordedFrom: string; scenarios: Record<string, Outcome> };
    expect(f.recordedFrom).toMatch(/^origin\/master [0-9a-f]{8}/);
    expect(Object.keys(f.scenarios).sort()).toEqual(SCENARIOS.map(([n]) => n).sort());
    expect(Object.values(f.scenarios).flatMap((o) => o.keys).filter((k) => k.endsWith(':muted'))).toEqual([]);
  });

  it('the scenarios are not empty: each type sends, and a switch changes what is sent (so parity is not vacuous)', () => {
    const sends = (name: string) => (runs.get(name) as Run).sends;
    for (const t of ['liq:short-11-04', 'liq:long-11-05', 'level', 'funding']) expect(sends(`${t}:all-on`).length).toBeGreaterThan(0);
    expect(sends('level:box-WO-off').length).toBeLessThan(sends('level:defaults').length);
    expect(sends('funding:BTC-off').length).toBeLessThan(sends('funding:all-on').length);
    expect(sends('liq:long-11-05:BTC-off')).not.toEqual(sends('liq:long-11-05:all-on'));
    expect(sends('liq:short-11-04:ETH-off')).not.toEqual(sends('liq:short-11-04:all-on'));
  });

  it.each(SCENARIOS.map(([name]) => name))('%s: the same sends as master, hash for hash, and master\'s unmuted rows', (name) => {
    if (RECORD) return;
    const r = runs.get(name) as Run;
    const m = master()[name] as Outcome;
    expect(r.sends).toEqual(m.sends);
    expect([...r.keys].sort()).toEqual([...m.keys].sort());
  });

  it.each(SCENARIOS.map(([name]) => name))('%s: every muted row is one master skipped, and with them the journal is the all-on one', (name) => {
    if (RECORD) return;
    const r = runs.get(name) as Run;
    const m = master()[name] as Outcome;
    const all = runs.get(allOnOf(name)) as Run;
    const strip = (k: string) => k.replace(/:muted$/, '');
    expect(r.muted.every((x) => x.key.endsWith(':muted'))).toBe(true);
    expect(r.muted.map((x) => strip(x.key)).filter((k) => m.keys.includes(k))).toEqual([]);
    // every row, a muted one under its sending key. Liquidations: the crossings only — an event's T0, members and
    // merges legitimately change when a coin's crossings stop being part of it.
    const full = (x: Run) => [...x.keys, ...x.muted.map((y) => strip(y.key))].filter((k) => !name.startsWith('liq:') || k.startsWith('liq:')).sort();
    expect(full(r)).toEqual(full(all));
    // all-on: nothing muted but the custom level's own switch (level 2's breakout_down)
    if (name.endsWith(':all-on')) expect(r.muted.filter((x) => x.by !== 'custom_event')).toEqual([]);
  });

  it('the box\'s level switches (WO off): the journal gains the weekly open\'s rows, muted by its event switch, and PDH/PDL by daily', () => {
    if (RECORD) return;
    const r = runs.get('level:box-WO-off') as Run;
    const by = (b: string) => r.muted.filter((x) => x.by === b).map((x) => x.key.split(':')[2]);
    expect(by('event').length).toBeGreaterThan(0);
    expect(new Set(by('event'))).toEqual(new Set(['WO']));
    expect(new Set(by('daily'))).toEqual(new Set(['PDH', 'PDL']));
  });

  it('a liquidation coin switched off: its crossings muted by the coin, and nothing else muted', () => {
    if (RECORD) return;
    for (const tape of Object.keys(LIQ_TAPES)) {
      for (const c of COINS) {
        const r = runs.get(`liq:${tape}:${c.base}-off`) as Run;
        expect(r.muted.every((x) => x.by === 'coin' && x.key.startsWith(`liq:${c.symbol}:`))).toBe(true);
      }
    }
    // the ones the tapes exercise: BTC crosses on both, BNB is IB-148's small event on both
    expect((runs.get('liq:long-11-05:BTC-off') as Run).muted.length).toBeGreaterThan(0);
    expect((runs.get('liq:short-11-04:BNB-off') as Run).muted.length).toBeGreaterThan(0);
  });
});
