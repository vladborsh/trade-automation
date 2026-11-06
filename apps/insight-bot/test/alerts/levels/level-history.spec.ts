import { LEVEL_DEFAULT_PARAMS, type LevelBar, type WebCandle } from '@trade-automation/contracts';
import { levelsInForce } from '@trade-automation/market-data-core';
import {
  BAR_MS, DAY_MS, HistoryLevelVenue, MemoryLevelJournal, fetchClosed, levelCountRows, levelCrossCheck, levelHistoryParams, levelHistoryStore,
  levelShippedCounts, levelTouchRows, replayLevels, seedFrom,
} from '../../../src/alerts/levels/backfill/level-history';
import { levelReplayRange, parseLevelCliArgs } from '../../../src/alerts/levels/backfill/level-backfill.cli';

/**
 * IB-127 (design P8) — the level history run's pieces. The scenario: BTC, previous ISO week (11-02 … 11-08) high
 * 100 / low 80, so PWH 100 / PWL 80 for the week of 11-09; October 120 / 60 (PMH / PML out of the way); every other
 * 15m close is 92. On Tuesday 11-10 06:00 a close at 101 (above PWH); then every close exactly AT 100 (a touch: no
 * event, P10's side kept) until Wednesday 11-11 10:00, a close at 99. A state started fresh on Wednesday has no side,
 * so only a seed from the week's start can give the crossunder.
 */
const utc = (m: number, d: number, h = 0, min = 0) => Date.UTC(2026, m - 1, d, h, min);
const WEEK = utc(11, 9);
const ABOVE = utc(11, 10, 6);
const BELOW = utc(11, 11, 10);
const COINS = [{ symbol: 'BTCUSDT', base: 'BTC' }];

function dailyCandles(to = utc(11, 12)): WebCandle[] {
  const out: WebCandle[] = [];
  for (let t = utc(8, 20); t < to; t += DAY_MS) {
    const c: WebCandle = { time: t / 1000, open: 90, high: 95, low: 85, close: 90, volume: 1 };
    if (t === utc(11, 4)) Object.assign(c, { high: 100, low: 80 });
    if (t === utc(10, 15)) Object.assign(c, { high: 120, low: 60 });
    out.push(c);
  }
  return out;
}

function scenario(): Map<number, number> {
  const m = new Map([[ABOVE, 101], [BELOW, 99]]);
  for (let t = ABOVE + BAR_MS; t < BELOW; t += BAR_MS) m.set(t, 100);
  return m;
}

function bars15m(from: number, to: number, closes: Map<number, number> = scenario()): LevelBar[] {
  const out: LevelBar[] = [];
  for (let t = from; t < to; t += BAR_MS) {
    const c = closes.get(t) ?? 92;
    out.push({ openMs: t, open: 92, high: Math.max(92, c) + 0.3, low: Math.min(92, c) - 0.3, close: c });
  }
  return out;
}

const venue = (bars = bars15m(utc(10, 31, 23, 45), utc(11, 12)), daily = dailyCandles()) =>
  new HistoryLevelVenue(new Map([['BTCUSDT', bars]]), new Map([['BTCUSDT', daily]]));

async function replay(fromMs: number, toMs: number, opts: { params?: typeof LEVEL_DEFAULT_PARAMS; bars?: LevelBar[] } = {}) {
  const j = new MemoryLevelJournal();
  const v = venue(opts.bars);
  const t = await replayLevels({ store: levelHistoryStore(j, { params: opts.params ?? LEVEL_DEFAULT_PARAMS, coins: COINS }), venue: v, build: 'dev' }, fromMs, toMs);
  return { j, t, v };
}
const names = (j: MemoryLevelJournal) => j.alerts.map((a) => `${a.kind}:${a.event}@${new Date(a.atMs).toISOString().slice(5, 16)}`);

describe('IB-127 HistoryLevelVenue', () => {
  it('bars15m: from `fromMs`, at most `limit`, only bars CLOSED by now', async () => {
    const v = venue();
    v.now = utc(11, 10, 1, 0); // the 00:45 bar closed exactly now
    const got = await v.bars15m('BTCUSDT', utc(11, 10, 0, 15), 10);
    expect(got.map((b) => b.openMs)).toEqual([utc(11, 10, 0, 15), utc(11, 10, 0, 30), utc(11, 10, 0, 45)]);
    expect(await v.bars15m('BTCUSDT', utc(11, 10), 2)).toHaveLength(2);
  });

  it('bars15m: a bar the venue skipped is skipped, the window still ends at fromMs + limit bars (as closedKlines)', async () => {
    const bars = bars15m(utc(11, 9), utc(11, 10)).filter((b) => b.openMs !== utc(11, 9, 1));
    const v = venue(bars);
    v.now = utc(11, 10);
    expect((await v.bars15m('BTCUSDT', utc(11, 9, 0, 45), 2)).map((b) => b.openMs)).toEqual([utc(11, 9, 0, 45)]);
  });

  it('daily: 70 days up to today; today carries only its open; nothing after now', async () => {
    const v = venue();
    v.now = utc(11, 9, 10);
    const d = await v.daily('BTCUSDT', utc(11, 9));
    expect(d).toHaveLength(70);
    expect(d[0]?.time).toBe((utc(11, 9) - 69 * DAY_MS) / 1000);
    expect(d.at(-1)).toEqual({ time: utc(11, 9) / 1000, open: 90, high: 90, low: 90, close: 90, volume: 0 });
  });

  it('daily: a forming day missing from the 1d fetch takes its first 15m bar\'s open', async () => {
    const v = venue(undefined, dailyCandles(utc(11, 9)));
    v.now = utc(11, 9, 0, 20);
    expect((await v.daily('BTCUSDT', utc(11, 9))).at(-1)).toMatchObject({ time: utc(11, 9) / 1000, open: 92, high: 92 });
  });

  it('the forming bar\'s open-only copy gives the SAME levels as the whole day would, at every bar of that day (Monday and a 1st included)', () => {
    for (const day of [utc(11, 9), utc(11, 1), utc(11, 11)]) {
      const full = dailyCandles(day + DAY_MS).map((c) => (c.time * 1000 === day ? { ...c, high: 140, low: 40, close: 70 } : c));
      const openOnly = full.map((c) => (c.time * 1000 === day ? { ...c, high: c.open, low: c.open, close: c.open } : c));
      for (let t = day; t < day + DAY_MS; t += BAR_MS) expect(levelsInForce(openOnly, t / 1000)).toEqual(levelsInForce(full, t / 1000));
    }
  });
});

describe('IB-127 replayLevels (the live loop, ticking once a minute)', () => {
  it('P10 is seeded from the PERIOD start, before the replay window: a replay from Wednesday still sees Tuesday\'s close above PWH → crossunder', async () => {
    const { j, t } = await replay(utc(11, 11), utc(11, 12));
    expect(names(j)).toEqual(['PWH:crossunder@11-11T10:00']);
    expect(j.alerts[0]?.details.firstBeyondAtMs).toBe(ABOVE + BAR_MS);
    expect(t).toMatchObject({ bars: 96, seeds: 1, failed: 0, warnings: {} });
  });

  it('the whole week: breakout up, then ONE crossunder for the period (P4), whatever follows', async () => {
    const closes = new Map([...scenario(), [BELOW + DAY_MS, 101], [BELOW + DAY_MS + BAR_MS, 99]]);
    const { j } = await replay(WEEK, utc(11, 13), { bars: bars15m(utc(10, 31, 23, 45), utc(11, 14), closes) });
    expect(names(j)).toEqual(['PWH:breakout_up@11-10T06:00', 'PWH:crossunder@11-11T10:00']);
  });

  it('×1 rows are the shipped defaults (PDH/PDL off); with `daily` on the PDH/PDL rows appear and nothing else changes', async () => {
    const off = await replay(WEEK, utc(11, 12));
    const on = await replay(WEEK, utc(11, 12), { params: levelHistoryParams(['BTCUSDT'], 1, true) });
    expect(levelHistoryParams(['BTCUSDT'], 1, false)).toBe(LEVEL_DEFAULT_PARAMS);
    expect(on.j.alerts.some((a) => a.kind === 'PDH' || a.kind === 'PDL')).toBe(true);
    expect(off.j.alerts.some((a) => a.kind === 'PDH' || a.kind === 'PDL')).toBe(false);
    expect(levelShippedCounts(on.j)).toEqual(levelShippedCounts(off.j));
    expect(levelCrossCheck(on.j, levelShippedCounts(off.j))).toBeNull();
  });

  it('a rerun into the same journal writes 0 (once-keys)', async () => {
    const j = new MemoryLevelJournal();
    const run = () => replayLevels({ store: levelHistoryStore(j, { params: LEVEL_DEFAULT_PARAMS, coins: COINS }), venue: venue(), build: 'dev' }, WEEK, utc(11, 12));
    const first = await run();
    const second = await run();
    expect(first.alerts + first.controls).toBeGreaterThan(0);
    expect(second).toMatchObject({ alerts: 0, controls: 0 });
  });

  it('never sends: the frozen settings say off, and markFired throws', async () => {
    const store = levelHistoryStore(new MemoryLevelJournal(), { params: LEVEL_DEFAULT_PARAMS, coins: COINS });
    expect((await store.settings()).enabled).toBe(false);
    expect(await store.recipients()).toEqual([]);
    await expect(store.markFired(1, 0, 1)).rejects.toThrow('never sends');
  });

  it('the band moves touches only; events are the same at ×½, ×1, ×2', async () => {
    const runs = await Promise.all([0.5, 1, 2].map((k) => replay(WEEK, utc(11, 12), { params: levelHistoryParams(['BTCUSDT'], k, true) })));
    const [half, one, two] = runs.map((r) => r.j);
    expect(names(half as MemoryLevelJournal)).toEqual(names(one as MemoryLevelJournal));
    expect(names(two as MemoryLevelJournal)).toEqual(names(one as MemoryLevelJournal));
    const touches = runs.map((r) => levelTouchRows(r.j, ['BTCUSDT'], 1, 3)[0]?.touches ?? 0);
    expect(touches[0]).toBeLessThanOrEqual(touches[1] as number);
    expect(touches[1]).toBeLessThanOrEqual(touches[2] as number);
  });

  it('both ends must be on the 15m grid', async () => {
    await expect(replay(WEEK + 60_000, utc(11, 12))).rejects.toThrow('15m grid');
  });
});

describe('IB-127 counts and the cross-check', () => {
  it('levelCountRows: per coin, kind and event, a weekly rate', async () => {
    const { j } = await replay(utc(11, 11), utc(11, 12));
    expect(levelCountRows(j, ['BTCUSDT'], 7)).toEqual([{ symbol: 'BTCUSDT', kind: 'PWH', event: 'crossunder', count: 1, perWeek: 1 }]);
  });

  it('levelCrossCheck names both sides on a mismatch', async () => {
    const { j } = await replay(utc(11, 11), utc(11, 12));
    const stored = { ...levelShippedCounts(j), alerts_crossunder: 0 };
    expect(levelCrossCheck(j, stored)).toMatch(/crossunder 1 .* differs .* crossunder 0/);
  });
});

describe('IB-127 fetchClosed', () => {
  it('pages of 1 500 at weight 10, the last one at its own limit and weight; steps by span, de-duplicates', async () => {
    const asked: Array<[number, number]> = [];
    const page = async (start: number, limit: number): Promise<WebCandle[]> => {
      asked.push([start, limit]);
      // the venue skips one bar and repeats the page's first
      const out: WebCandle[] = [];
      for (let i = 0; i < limit; i++) if (i !== 5) out.push({ time: (start + i * BAR_MS) / 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 });
      return [out[0] as WebCandle, ...out];
    };
    const weights: number[] = [];
    const r = await fetchClosed(page, BAR_MS, 0, 3_200 * BAR_MS, async (w) => { weights.push(w); });
    expect(asked).toEqual([[0, 1500], [1500 * BAR_MS, 1500], [3000 * BAR_MS, 200]]);
    expect(weights).toEqual([10, 10, 2]);
    expect(r).toMatchObject({ calls: 3, weight: 22 });
    expect(r.candles).toHaveLength(3_200 - 3);
  });

  it('seedFrom: the bar before the month start of the replay\'s first bar', () => {
    expect(seedFrom(utc(8, 8, 3, 15))).toBe(utc(8, 1) - BAR_MS);
  });
});

describe('IB-127 CLI arguments', () => {
  it('--until is the first heartbeat\'s 15m close; the replay is the 90 days of bars before the bar live evaluated first', () => {
    const a = parseLevelCliArgs(['--dry-run', '--until', '2026-11-06T05:30:00.000Z']);
    expect(a).toEqual({ mode: 'dry-run', untilMs: utc(11, 6, 5, 30) });
    expect(levelReplayRange(a.untilMs)).toEqual({ fromMs: utc(11, 6, 5, 15) - 90 * DAY_MS, toMs: utc(11, 6, 5, 15) });
  });

  it('refuses a time off the 15m grid, a missing zone, both or neither mode', () => {
    expect(() => parseLevelCliArgs(['--write', '--until', '2026-11-06T05:31:00Z'])).toThrow('not a 15m close');
    expect(() => parseLevelCliArgs(['--write', '--until', '2026-11-06T05:30:00'])).toThrow('zone');
    expect(() => parseLevelCliArgs(['--write', '--dry-run', '--until', '2026-11-06T05:30:00Z'])).toThrow('usage');
    expect(() => parseLevelCliArgs(['--write'])).toThrow('--until is required');
  });
});
