import { WebKpiHistorySchema } from '@trade-automation/contracts';
import {
  CAP_BREAK_AFTER_SEC, capHistory, FUNDING_BARS, fundingHistory, history, OI_BREAK_AFTER_SEC, oiHistory,
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
