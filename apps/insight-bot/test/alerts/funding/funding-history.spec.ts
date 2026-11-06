import { FUNDING_DEFAULT_PARAMS, FundingEnterDetailsSchema, FundingFlipDetailsSchema } from '@trade-automation/contracts';
import { parseFundingCliArgs } from '../../../src/alerts/funding/backfill/funding-backfill.cli';
import {
  HistoryFundingVenue, MemoryFundingJournal, fetchSettled, fundingCountRows, fundingCrossCheck, fundingHistoryParams, fundingHistoryStore,
  replayEnd, replayFunding, type SettledPoint,
} from '../../../src/alerts/funding/backfill/funding-history';
import { FundingAlertLoop } from '../../../src/alerts/funding/funding-alert-loop';
import type { FundingAlertStore, FundingCommit } from '../../../src/alerts/funding/pg/funding-alerts.repo';
import { FUNDING_FLOOR_PER_8H } from '../../../src/insights/thresholds';

/**
 * IB-125 (F9) — the funding history run over settled rates:
 * - the venue as the replay sees it: inside (T(k−1), T(k)) a check reads T(k)'s rate, its sample ends at T(k−1);
 * - the live loop's own rules: one `enter` at the start of the first extreme interval, the episode's end, a flip;
 *   the same rows as a live loop fed the same rates 5 min apart;
 * - frozen settings, never sent, state kept in memory (the base store sees only alerts), a rerun adds 0;
 * - ×½ / ×1 / ×2 floors, the cross-check, the paging, the replay's end, the CLI's arguments.
 */
const H = 3_600_000;
const DAY = 24 * H;
const STEP = 5 * 60_000;
const T0 = Date.UTC(2026, 4, 1); // a settlement, 00:00 UTC

/** 8 h settlements from T0 − 30 days: a month of ordinary rates, then `tail`. */
function series(tail: number[]): SettledPoint[] {
  const base = [0.0001, 0.00005, 0.00015, 0.00008, 0.00012];
  const pts: SettledPoint[] = [];
  for (let i = 0; i < 90; i++) pts.push({ time: (T0 - (90 - i) * 8 * H) / 1000, rate: base[i % 5] as number });
  pts.push({ time: T0 / 1000, rate: 0.0001 });
  tail.forEach((rate, i) => pts.push({ time: (T0 + (i + 1) * 8 * H) / 1000, rate }));
  return pts;
}

const COINS = [{ symbol: 'BTCUSDT', base: 'BTC' }];

async function run(tail: number[], k = 1, journal = new MemoryFundingJournal()) {
  const s = new Map([['BTCUSDT', series(tail)]]);
  const toMs = replayEnd(s, T0 + 100 * DAY);
  const totals = await replayFunding({
    store: fundingHistoryStore(journal, { params: fundingHistoryParams(['BTCUSDT'], k), coins: COINS }), venue: new HistoryFundingVenue(s), build: 'dev',
  }, T0, toMs);
  return { journal, totals, toMs };
}

describe('IB-125 funding history run (F9)', () => {
  it('the venue at `now`: the rate that settles at the end of the interval; the sample up to the last settlement; none after the last', async () => {
    const v = new HistoryFundingVenue(new Map([['BTCUSDT', series([0.0009, 0.0002])]]));
    v.now = T0 + 3 * H; // inside (T0, T0 + 8 h)
    expect(await v.premiumIndex('BTCUSDT')).toEqual({ rate: 0.0009, timeMs: T0 + 3 * H, nextFundingTimeMs: T0 + 8 * H });
    const sample = await v.settled('BTCUSDT', v.now - 30 * DAY, v.now);
    expect(sample.at(-1)).toEqual({ time: T0 / 1000, rate: 0.0001 }); // T0 is in, T0 + 8 h (the one being judged) is not
    expect(sample).toHaveLength(90);
    v.now = T0 + 8 * H; // on a settlement: it is history now, the next interval's rate is read
    expect((await v.premiumIndex('BTCUSDT')).rate).toBe(0.0002);
    expect((await v.settled('BTCUSDT', v.now - 30 * DAY, v.now)).at(-1)?.rate).toBe(0.0009);
    v.now = T0 + 16 * H;
    await expect(v.premiumIndex('BTCUSDT')).rejects.toThrow('no settlement after');
    expect(v.calls).toBe(5); // the refused read is counted too
  });

  it('F3/F4/F5 by the live rules: one enter at the START of the first extreme interval, the episode ends, then a flip', async () => {
    // 4 settlements at 0.08 % (rare, above the floor) = 32 h; 2 ordinary; then 3 negative
    const { journal, totals } = await run([0.0008, 0.0008, 0.0008, 0.0008, 0.0001, 0.0001, -0.0002, -0.0002, -0.0002, 0.0001]);
    expect(totals).toMatchObject({ enters: 1, flips: 1, stale: 0, insufficient: 0, warnings: {} });
    const [enter, flip] = journal.alerts;
    expect(enter).toMatchObject({ event: 'enter', side: 'high', atMs: T0, dedupeKey: `funding:BTCUSDT:high:${T0}` });
    expect(FundingEnterDetailsSchema.parse(enter?.details)).toMatchObject({ rate: 0.0008, ratePer8h: 0.0008, intervalH: 8, nextFundingTimeMs: T0 + 8 * H });
    // the episode ran T0 → T0 + 32 h (the first check outside); the negative rate settles at T0 + 56 h, read from T0 + 48 h
    expect(FundingFlipDetailsSchema.parse(flip?.details)).toMatchObject({ side: 'high', episodeStartMs: T0, episodeEndMs: T0 + 32 * H, episodeHours: 32, flipSinceMs: T0 + 48 * H });
    expect(flip?.atMs).toBe(T0 + 48 * H);
  });

  it('the same rows as a live loop fed the same rates every 5 min', async () => {
    const tail = [0.0001, 0.0008, 0.0008, 0.0002, 0.0009, 0.0009, 0.0009, 0.0001, -0.0001, -0.0003, -0.0003, -0.0001, 0.0001, 0.0001];
    const { journal, toMs } = await run(tail);
    // the reference: FundingAlertLoop with a hand-written port (the rate of the interval, the settled list up to now)
    const pts = series(tail);
    const ref = new MemoryFundingJournal();
    const state = fundingHistoryStore(ref, { params: FUNDING_DEFAULT_PARAMS, coins: COINS });
    let now = T0;
    const loop = new FundingAlertLoop({
      store: state, build: 'dev', source: 'backfill', webBaseUrl: '', send: async () => { throw new Error('never'); },
      venue: {
        premiumIndex: async () => { const n = pts.find((p) => p.time * 1000 > now) as SettledPoint; return { rate: n.rate, timeMs: now, nextFundingTimeMs: n.time * 1000 }; },
        settled: async (_s, from, to) => pts.filter((p) => p.time * 1000 > from && p.time * 1000 <= to),
      },
    });
    for (; now < toMs; now += STEP) await loop.tick(now);
    expect(journal.alerts.map(({ id: _id, ...a }) => a)).toEqual(ref.alerts.map(({ id: _id, ...a }) => a));
    expect(journal.controls.map(({ id: _id, ...c }) => c)).toEqual(ref.controls.map(({ id: _id, ...c }) => c));
    // high at 0.08 % (16 h: no flip after it), high again at 0.09 % (24 h), its flip at −0.01 %, then low at −0.03 %
    expect(journal.alerts.map((a) => `${a.event} ${a.side}`)).toEqual(['enter high', 'enter high', 'flip high', 'enter low']);
  });

  it('frozen settings, never sent: the base store sees alerts only (no state rows), its switch is never read; a rerun adds 0', async () => {
    const commits: FundingCommit[] = [];
    const journal = new MemoryFundingJournal();
    const base: FundingAlertStore = Object.assign(Object.create(journal) as MemoryFundingJournal, {
      commit: (x: FundingCommit) => { commits.push(x); return journal.commit(x); },
      settings: async () => { throw new Error('the run must not read the live switch'); },
    });
    const tail = [0.0008, 0.0008, 0.0008, 0.0008, 0.0001, 0.0001, -0.0002, -0.0002, -0.0002, 0.0001];
    const first = await run(tail, 1, base as MemoryFundingJournal);
    expect(first.totals.enters + first.totals.flips).toBe(2);
    expect(commits).toHaveLength(2);
    expect(commits.every((c) => c.states.length === 0 && c.alerts.length === 1 && c.source === 'backfill')).toBe(true);
    const before = { alerts: journal.alerts.length, controls: journal.controls.length, paths: journal.paths };
    expect(before.controls).toBeGreaterThan(0);
    const rerun = await run(tail, 1, base as MemoryFundingJournal);
    expect(rerun.totals).toMatchObject({ enters: 0, flips: 0, controls: 0 });
    expect({ alerts: journal.alerts.length, controls: journal.controls.length, paths: journal.paths }).toEqual(before);
  });

  it('floors ×½ / ×1 / ×2: ×1 is the shipped default as it is; a rate between the floors counts only below its own', async () => {
    expect(fundingHistoryParams(['BTCUSDT'], 1)).toBe(FUNDING_DEFAULT_PARAMS);
    expect(fundingHistoryParams(['BTCUSDT', 'ETHUSDT'], 2).perCoin).toEqual({
      BTCUSDT: { enabled: true, floorPer8h: FUNDING_FLOOR_PER_8H * 2 }, ETHUSDT: { enabled: true, floorPer8h: FUNDING_FLOOR_PER_8H * 2 },
    });
    // 0.04 %: rare for this month, above 0.03 % and 0.015 %, below 0.06 %
    const tail = [0.0004, 0.0001, 0.0001, 0.0001];
    const counts = await Promise.all([0.5, 1, 2].map(async (k) => (await run(tail, k)).totals.enters));
    expect(counts).toEqual([1, 1, 0]);
    const { journal } = await run(tail, 1);
    expect(fundingCountRows(journal, ['BTCUSDT'], 1, 7)).toEqual([{ symbol: 'BTCUSDT', multiplier: 1, floorPer8h: 0.0003, enters: 1, high: 1, low: 0, flips: 0, otherTail: 0, perWeek: 1, flipsPerWeek: 0 }]);
  });

  it('the cross-check: the ×1 journal against the stored rows by event and kind', async () => {
    const { journal } = await run([0.0008, 0.0001, 0.0001, 0.0001]);
    const random = journal.controls.filter((c) => c.kind === 'random').length;
    const nm = journal.controls.filter((c) => c.kind === 'near_miss').length;
    expect(fundingCrossCheck(journal, { alerts_enter: 1, controls_random: random, controls_near_miss: nm, paths: 99 })).toBeNull();
    expect(fundingCrossCheck(journal, { alerts_enter: 1, alerts_flip: 1, controls_random: random, controls_near_miss: nm })).toMatch(/differs/);
  });

  it('fetchSettled: pages of `limit` until a short one, advanced past the last time, de-duplicated; a bad rate throws', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ symbol: 'X', fundingTime: T0 + i * 8 * H + 3, fundingRate: String(0.0001 * (i + 1)) }));
    const asked: number[] = [];
    let paced = 0;
    const page = async (start: number) => { asked.push(start); return rows.filter((r) => r.fundingTime >= start).slice(0, 2).concat(start === T0 ? [] : []); };
    const r = await fetchSettled(page, T0, T0 + DAY * 10, 2, async () => { paced++; });
    expect(r.points.map((p) => p.time)).toEqual(rows.map((x) => Math.floor(x.fundingTime / 1000)));
    expect(asked).toEqual([T0, T0 + 8 * H + 4, T0 + 24 * H + 4]);
    expect(r.calls).toBe(3);
    expect(paced).toBe(3);
    await expect(fetchSettled(async () => [{ symbol: 'X', fundingTime: T0, fundingRate: '' }], T0, T0 + DAY, 2, async () => undefined)).rejects.toThrow('not a number');
  });

  it('replayEnd: --until, or the earliest coin\'s last settlement when that is before it', () => {
    const s = new Map([['A', series([0.0001, 0.0001])], ['B', series([0.0001])]]);
    expect(replayEnd(s, T0 + 100 * DAY)).toBe(T0 + 8 * H);
    expect(replayEnd(s, T0 + 3 * H)).toBe(T0 + 3 * H);
  });

  it('the CLI arguments: one mode, --until with a zone', () => {
    expect(parseFundingCliArgs(['--dry-run', '--until', '2026-11-06T22:00:00Z'])).toEqual({ mode: 'dry-run', untilMs: Date.UTC(2026, 10, 6, 22) });
    expect(parseFundingCliArgs(['--write', '--until', '2026-11-06T22:00:00+00:00']).mode).toBe('write');
    expect(() => parseFundingCliArgs(['--dry-run', '--write', '--until', '2026-11-06T22:00:00Z'])).toThrow('usage');
    expect(() => parseFundingCliArgs(['--write'])).toThrow('--until is required');
    expect(() => parseFundingCliArgs(['--write', '--until', '2026-11-06T22:00:00'])).toThrow('with a zone');
  });
});
