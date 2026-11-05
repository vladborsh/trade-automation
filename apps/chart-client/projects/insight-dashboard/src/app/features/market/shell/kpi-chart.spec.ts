import { describe, expect, it } from 'vitest';
import type { WebKpiHistory } from '@trade-automation/contracts';
import { kpiChartGeometry, PAD_PCT, type KpiAreaGeometry, type KpiBarsGeometry } from './kpi-chart';

/** IB-118 — the tile chart's geometry: breaks, min/max dots on their points, tone, bars around zero. */
const area = (values: number[], stepSec = 600, breakAfterSec: number | null = 1800, times?: number[]): WebKpiHistory => {
  const points = values.map((value, i) => ({ time: times ? times[i] : 1_000 + i * stepSec, value }));
  return { kind: 'area', points, from: points[0].time, to: points[points.length - 1].time, min: Math.min(...values), max: Math.max(...values), breakAfterSec };
};
const bars = (values: number[]): WebKpiHistory => {
  const points = values.map((value, i) => ({ time: 1_000 + i * 28_800, value }));
  return { kind: 'bars', points, from: points[0].time, to: points[points.length - 1].time, min: Math.min(...values), max: Math.max(...values), breakAfterSec: null };
};

describe('kpiChartGeometry', () => {
  it('null history draws nothing — and an absent one (undefined, IB-BUG-038) neither, without throwing', () => {
    expect(kpiChartGeometry(null)).toBeNull();
    expect(kpiChartGeometry(undefined)).toBeNull();
  });

  it('area: one unbroken run spans the box; the max at the top pad, the min at the bottom pad', () => {
    const g = kpiChartGeometry(area([5, 9, 1, 4])) as KpiAreaGeometry;
    expect(g.segments).toHaveLength(1);
    expect(g.segments[0].line).toMatch(/^M0 /);
    expect(g.segments[0].area).toMatch(/ L100 100 L0 100 Z$/);
    expect(g.max).toEqual({ x: 33.33, y: PAD_PCT });
    expect(g.min).toEqual({ x: 66.67, y: 100 - PAD_PCT });
    expect(g.last).toEqual({ x: 100, y: 60 }); // 4 of 1..9: 10 + 5/8 × 80
  });

  it('min and max dots sit ON the points that hold min / max — the first such point when it repeats', () => {
    const values = [3, 7, 2, 7, 2, 5];
    const h = area(values);
    const g = kpiChartGeometry(h) as KpiAreaGeometry;
    const at = (i: number) => ({ x: Math.round(((h.points[i].time - h.from) / (h.to - h.from)) * 10_000) / 100 });
    expect(g.max.x).toBe(at(1).x);
    expect(g.min.x).toBe(at(2).x);
    expect(g.segments[0].line.split(' L')[1]).toBe(`${g.max.x} ${g.max.y}`); // the max dot is the path's own vertex
  });

  it('a gap over breakAfterSec breaks the line — 30 min joins, 31 min does not; nothing is interpolated', () => {
    const t = [0, 600, 1200, 3000, 3600, 5460];
    const g = kpiChartGeometry(area([1, 2, 3, 4, 5, 6], 600, 1800, t)) as KpiAreaGeometry;
    // 1200 → 3000 is exactly 30 min: joined; 3600 → 5460 is 31 min: broken
    expect(g.segments).toHaveLength(2);
    expect(g.segments.map((s) => s.line.split(/[ML]/).filter(Boolean).length)).toEqual([5, 1]);
  });

  it('x is time, not index: a broken run is drawn where its time is', () => {
    const g = kpiChartGeometry(area([1, 2, 3], 600, 1800, [0, 600, 6000])) as KpiAreaGeometry;
    expect(g.segments[1].line).toBe(`M100 ${PAD_PCT}`);
    expect(g.last.x).toBe(100);
  });

  it('tone: down when the newest is below the oldest, up when above, flat when equal', () => {
    expect((kpiChartGeometry(area([5, 9, 4])) as KpiAreaGeometry).tone).toBe('down');
    expect((kpiChartGeometry(area([5, 1, 6])) as KpiAreaGeometry).tone).toBe('up');
    expect((kpiChartGeometry(area([5, 9, 5])) as KpiAreaGeometry).tone).toBe('flat');
  });

  it('a flat series and a single point stay inside the box (no division by zero)', () => {
    const flat = kpiChartGeometry(area([4, 4, 4])) as KpiAreaGeometry;
    expect(flat.last.y).toBe(50);
    const one = kpiChartGeometry(area([4])) as KpiAreaGeometry;
    expect(one.segments).toHaveLength(1);
    expect(one.last).toEqual({ x: 100, y: 50 });
  });

  it('bars: around zero — positive above (longs pay), negative below (shorts pay), the newest lit', () => {
    const g = kpiChartGeometry(bars([0.0001, -0.00005, 0, 0.00005])) as KpiBarsGeometry;
    // range 0.00015, usable 80 %: zero sits at 10 + 80 × 2/3
    expect(g.zero).toBe(63.33);
    expect(g.bars.map((b) => b.side)).toEqual(['longs_pay', 'shorts_pay', 'flat', 'longs_pay']);
    expect(g.bars.map((b) => b.lit)).toEqual([false, false, false, true]);
    expect(g.bars[0]).toMatchObject({ top: PAD_PCT, height: 53.33 }); // the max reaches the top pad
    expect(g.bars[1]).toMatchObject({ top: 63.33, height: 26.67 }); // hangs from zero
    expect(g.bars[2].height).toBe(0);
    expect(g.bars[0].x + g.bars[0].width).toBeLessThan(g.bars[1].x); // a gap between bars
  });

  it('bars: an all-positive series stands on a zero line at the bottom pad', () => {
    const g = kpiChartGeometry(bars([1, 2, 4])) as KpiBarsGeometry;
    expect(g.zero).toBe(100 - PAD_PCT);
    expect(g.bars.every((b) => b.top + b.height === g.zero)).toBe(true);
  });
});
