import { WebKpiHistorySchema } from '@trade-automation/contracts';
import {
  CAP_BREAK_AFTER_SEC, capHistory, dominanceHistory, FUNDING_BARS, fundingHistory, history, OI_BREAK_AFTER_SEC, oiHistory,
} from '../../../../src/web/market/positioning/kpis.history';

/** IB-118 — the KPI tiles' 7-day series, pure: what they cover, min/max over the points, the 6 h rule. */
const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 5, 0);
const rows = (n: number, stepMs: number, f: (i: number) => number = (i) => 2.6e12 + i * 1e9) =>
  Array.from({ length: n }, (_, i) => ({ tsMs: T0 + i * stepMs, totalUsd: f(i), btcPct: null, ethPct: null }));

describe('capHistory — our own table, 6 h before a chart', () => {
  it('no rows: no chart, «копим историю: 0 ч»', () => {
    expect(capHistory([])).toEqual({ history: null, collectingHours: 0 });
  });

  it('5 h 50 min of rows: still no chart, the hours held floored (5)', () => {
    expect(capHistory(rows(36, 10 * 60_000))).toEqual({ history: null, collectingHours: 5 });
  });

  it('exactly 6 h: a chart, its span stated as the rows cover it (not seven days)', () => {
    const r = capHistory(rows(37, 10 * 60_000));
    expect(r.collectingHours).toBeNull();
    expect(r.history).toMatchObject({ kind: 'area', from: T0 / 1000, to: (T0 + 6 * H) / 1000, breakAfterSec: CAP_BREAK_AFTER_SEC });
    expect(r.history?.points).toHaveLength(37);
    expect(WebKpiHistorySchema.safeParse(r.history).success).toBe(true);
  });

  it('a gap is kept as a gap: the 30-min break rule travels with the points, nothing is filled in', () => {
    const gappy = [...rows(20, 10 * 60_000), ...rows(20, 10 * 60_000).map((r) => ({ ...r, tsMs: r.tsMs + 5 * H }))];
    const h = capHistory(gappy).history;
    expect(h?.points).toHaveLength(40); // no interpolated points
    expect(h?.breakAfterSec).toBe(30 * 60);
    expect((h?.points[20].time ?? 0) - (h?.points[19].time ?? 0)).toBeGreaterThan(30 * 60);
  });
});

describe('min / max are points', () => {
  it('min and max are values the series holds, and from/to its first and last time', () => {
    const vals = [5, 3, 9, 9, 4, 1, 6];
    const h = history('area', vals.map((v, i) => ({ time: 100 + i, value: v })), 60);
    expect(h).toMatchObject({ min: 1, max: 9, from: 100, to: 106 });
    expect(h?.points.map((p) => p.value)).toContain(h?.min);
    expect(h?.points.map((p) => p.value)).toContain(h?.max);
  });

  it('null and non-finite values are not points (and cannot be the min); nothing left is null, not []', () => {
    const h = history('area', [{ time: 1, value: null }, { time: 2, value: 7 }, { time: 3, value: Number.NaN }, { time: 4, value: 8 }], 60);
    expect(h).toMatchObject({ min: 7, max: 8, from: 2, to: 4 });
    expect(history('area', [{ time: 1, value: null }], 60)).toBeNull();
    expect(history('bars', [], null)).toBeNull();
  });
});

describe('OI and funding', () => {
  it('OI: the USD notional per point, a missing hour breaks (1.5 h)', () => {
    const h = oiHistory([{ time: 0, notional: 7.4e9 }, { time: 3600, notional: null }, { time: 7200, notional: 8.1e9 }]);
    expect(h).toMatchObject({ kind: 'area', min: 7.4e9, max: 8.1e9, breakAfterSec: OI_BREAK_AFTER_SEC });
    expect(h?.points).toHaveLength(2);
  });

  it('funding: the LAST 21 settlements of the 30-day baseline, as bars, with their own times', () => {
    const settlements = Array.from({ length: 90 }, (_, i) => ({ time: 1_000 + i * 28_800, rate: (i - 80) / 1e5 }));
    const h = fundingHistory(settlements);
    expect(h?.points).toHaveLength(FUNDING_BARS);
    expect(h).toMatchObject({ kind: 'bars', breakAfterSec: null, from: settlements[69].time, to: settlements[89].time, min: -11 / 1e5, max: 9 / 1e5 });
    expect(fundingHistory([])).toBeNull();
  });
});

describe('IB-131 dominanceHistory — BTC and ETH from the cap rows, only rows with btc_pct', () => {
  /** `n` rows 10 min apart; BTC 60 + i/100, ETH 11 − i/100 unless `eth` says otherwise. */
  const dom = (n: number, opts: { start?: number; btc?: (i: number) => number | null; eth?: (i: number) => number | null } = {}) =>
    Array.from({ length: n }, (_, i) => ({
      tsMs: T0 + ((opts.start ?? 0) + i) * 10 * 60_000, totalUsd: 2.6e12,
      btcPct: opts.btc ? opts.btc(i) : 60 + i / 100, ethPct: opts.eth ? opts.eth(i) : 11 - i / 100,
    }));

  it('the 6 h threshold counts rows WITH btc_pct, not cap rows: a week of cap rows and 5 h 50 min of dominance is no chart', () => {
    const preMigration = rows(1000, 10 * 60_000); // btcPct null: rows written before 030
    const recent = dom(36, { start: 1000 }); // 5 h 50 min
    expect(dominanceHistory([...preMigration, ...recent])).toBeNull();
    const h = dominanceHistory([...preMigration, ...dom(37, { start: 1000 })]); // exactly 6 h
    expect(h).toMatchObject({ kind: 'lines', breakAfterSec: CAP_BREAK_AFTER_SEC, from: (T0 + 1000 * 600_000) / 1000, to: (T0 + 1036 * 600_000) / 1000 });
    expect(h?.points).toHaveLength(37);
    expect(WebKpiHistorySchema.safeParse(h).success).toBe(true);
    expect(dominanceHistory([])).toBeNull();
  });

  it('a row with BTC but no ETH is a hole in ETH only — no ETH point there, BTC unbroken, nothing filled in', () => {
    const h = dominanceHistory(dom(40, { eth: (i) => (i === 20 ? null : 11 - i / 100) }));
    expect(h?.points).toHaveLength(40);
    expect(h?.second?.points).toHaveLength(39);
    expect(h?.second?.points.map((p) => p.time)).not.toContain(h?.points[20].time);
    expect(h?.second?.label).toBe('ETH');
    expect(WebKpiHistorySchema.safeParse(h).success).toBe(true);
  });

  it('a row with ETH but no BTC is not a dominance row: neither line has it', () => {
    const h = dominanceHistory(dom(40, { btc: (i) => (i === 10 ? null : 60) }));
    expect(h?.points).toHaveLength(39);
    expect(h?.second?.points).toHaveLength(39);
  });

  it('a gap over 30 min stays a gap in both lines: the break rule travels with the points', () => {
    const h = dominanceHistory([...dom(20), ...dom(20, { start: 30 })]); // 100 min missing
    expect(h?.breakAfterSec).toBe(30 * 60);
    expect(h?.points).toHaveLength(40);
    expect((h?.points[20].time ?? 0) - (h?.points[19].time ?? 0)).toBeGreaterThan(30 * 60);
    expect((h?.second?.points[20].time ?? 0) - (h?.second?.points[19].time ?? 0)).toBeGreaterThan(30 * 60);
  });

  it('min / max of each line are values that line holds', () => {
    const btc = [60.1, 59.8, 60.4, 60.0];
    const eth = [11.2, 11.5, 10.9, 11.0];
    const h = dominanceHistory(Array.from({ length: 40 }, (_, i) => ({ tsMs: T0 + i * 600_000, totalUsd: 1, btcPct: btc[i % 4], ethPct: eth[i % 4] })));
    expect(h).toMatchObject({ min: 59.8, max: 60.4, second: { min: 10.9, max: 11.5 } });
    expect(h?.points.map((p) => p.value)).toEqual(expect.arrayContaining([h?.min, h?.max]));
    expect(h?.second?.points.map((p) => p.value)).toEqual(expect.arrayContaining([h?.second?.min, h?.second?.max]));
  });

  it('no ETH at all: no chart (two strips or none) — and the other kinds carry second: null', () => {
    expect(dominanceHistory(dom(40, { eth: () => null }))).toBeNull();
    expect(capHistory(rows(37, 10 * 60_000)).history?.second).toBeNull();
    expect(oiHistory([{ time: 0, notional: 1 }])?.second).toBeNull();
  });
});
