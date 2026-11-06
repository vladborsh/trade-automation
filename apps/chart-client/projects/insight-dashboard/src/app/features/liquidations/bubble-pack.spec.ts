import type { WebLiquidationLargeEvent } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import liqFixture from '../../../../../../e2e-insight-dashboard/fixtures/liquidations-overview.24h.json';
import { BUBBLE_GAP, BUBBLE_MIN_SCALE, MORE_AIR_PX, MORE_BAND_PX, moreMarks, moreWidth } from './bubble-pack';
import { BUBBLE_R_MAX, BUBBLE_R_MIN, bubbleLayout, HOURLY_PAD_BOTTOM, type BubbleView } from './liq-layout';

/**
 * IB-BUG-042 — no two bubbles overlap, every one stays inside its half, and every event is accounted
 * for: drawn, or counted in a «+N» mark. Checked through `bubbleLayout`, the function the chart calls.
 */
const STROKE_HALF = 0.5;
const ev = (time: number, usd: number, side: 'long' | 'short', i = 0): WebLiquidationLargeEvent => ({
  time, usd, side, symbol: `C${i}USDT`, base: `C${i}`, price: 1, venue: 'binance', xMedian: null, seriesId: null, seriesCount: 0, seriesSpanSec: 0,
});
const asOf = Date.UTC(2026, 10, 5, 13, 33) / 1000;
const week = { from: asOf - 7 * 86_400, to: asOf };
const day = { from: asOf - 86_400, to: asOf };
const days = { days: true, offset: () => 0 };
/** A deterministic spread of amounts, 0.5 M – 20 M: a few big, many small, as a cascade gives. */
const usdAt = (i: number) => 5e5 + 2e7 * ((i * 7919) % 1000 / 1000) ** 4;

/** Every way the drawing can be wrong, as one list: empty means the layout is sound. */
function defects(l: ReturnType<typeof bubbleLayout>, width: number, height: number, total: number): string[] {
  const out: string[] = [];
  const bottom = height - HOURLY_PAD_BOTTOM;
  const bySide = (s: 'short' | 'long') => l.bubbles.filter((b) => b.event.side === s);
  for (const b of l.bubbles) {
    const up = b.event.side === 'short';
    if (b.cy - b.r - STROKE_HALF < 0 || b.cy + b.r + STROKE_HALF > bottom) out.push(`outside the box: ${fmt(b)}`);
    if (b.cx - b.r < 0 || b.cx + b.r > width) out.push(`outside left/right: ${fmt(b)}`);
    if (up ? b.cy + b.r > l.axisY : b.cy - b.r < l.axisY) out.push(`across the axis: ${fmt(b)}`);
  }
  for (const s of ['short', 'long'] as const) {
    const bs = bySide(s);
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const [a, b] = [bs[i], bs[j]];
      if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.r + b.r + BUBBLE_GAP - 1e-6) out.push(`overlap: ${fmt(a)} / ${fmt(b)}`);
    }
    // the marks: inside the chart, apart from each other, and in a band no bubble reaches
    const ms = l.more.filter((m) => m.side === s).sort((a, b) => a.x - b.x);
    for (const m of ms) if (m.x - moreWidth(m.count) / 2 < 0 || m.x + moreWidth(m.count) / 2 > width) out.push(`mark outside: ${m.label} at ${m.x}`);
    for (let i = 1; i < ms.length; i++) {
      if (ms[i].x - ms[i - 1].x < (moreWidth(ms[i].count) + moreWidth(ms[i - 1].count)) / 2 + MORE_AIR_PX - 1e-6) out.push(`marks touch: ${ms[i - 1].label} / ${ms[i].label}`);
    }
    if (ms.length > 0) {
      const band = s === 'short' ? [0, MORE_BAND_PX] : [bottom - MORE_BAND_PX, bottom];
      for (const b of bs) if (b.cy + b.r + STROKE_HALF > band[0] && b.cy - b.r - STROKE_HALF < band[1]) out.push(`bubble in the «+N» band: ${fmt(b)}`);
    }
  }
  const counted = l.bubbles.length + l.more.reduce((n, m) => n + m.count, 0);
  if (counted !== total) out.push(`${total} events, ${counted} drawn or counted`);
  return out;
}
const fmt = (b: BubbleView) => `${b.event.side} cx ${b.cx.toFixed(1)} cy ${b.cy.toFixed(1)} r ${b.r.toFixed(1)}`;

describe('bubbleLayout — towers (IB-BUG-042)', () => {
  for (const width of [324, 1158]) {
    it(`500 shorts over 7d, most in three hours: no overlaps, all inside, all counted — ${width} px`, () => {
      const events = Array.from({ length: 500 }, (_, i) => {
        const hour = i % 5 === 0 ? (i * 37) % 168 : [20, 21, 90][i % 3]; // 80 % in three cascade hours
        return ev(week.from + hour * 3600 + (i % 60) * 60, usdAt(i), 'short', i);
      });
      const l = bubbleLayout(events, week, { width, height: 140 }, days);
      expect(defects(l, width, 140, 500)).toEqual([]);
      expect(l.more.length).toBeGreaterThan(0); // 500 do not fit in one half: the «+N» path is exercised
      expect(l.bubbles.every((b) => b.event.side === 'short')).toBe(true);
    });
  }

  it('500 longs at one minute: one column, one «+N», no overlap', () => {
    const events = Array.from({ length: 500 }, (_, i) => ev(day.to - 600, usdAt(i), 'long', i));
    const l = bubbleLayout(events, day, { width: 324, height: 140 });
    expect(defects(l, 324, 140, 500)).toEqual([]);
    expect(l.more).toHaveLength(1);
    expect(l.more[0].side).toBe('long');
  });

  it('a column taller than its half shrinks every radius ALIKE (area ∝ money still holds) before anything is counted', () => {
    const column = [0, 1, 2].map((i) => ev(day.to - 600 + i, [4e6, 1e6, 1e6][i], 'short', i));
    const l = bubbleLayout(column, day, { width: 324, height: 140 });
    expect(defects(l, 324, 140, 3)).toEqual([]);
    expect(l.more).toEqual([]);
    const [big, small] = [l.bubbles.find((b) => b.event.usd === 4e6)!, l.bubbles.find((b) => b.event.usd === 1e6)!];
    expect(big.r).toBeLessThan(BUBBLE_R_MAX); // 18 + 2 × 9 does not fit in 61 px: shrunk
    expect(big.r / small.r).toBeCloseTo(2); // √4
  });

  it('both sides share the scale: the side that must shrink shrinks the other too', () => {
    const tower = [0, 1, 2, 3].map((i) => ev(day.to - 600 + i, 4e6, 'short', i));
    const l = bubbleLayout([...tower, ev(day.from + 3600, 4e6, 'long', 9)], day, { width: 324, height: 140 });
    const long = l.bubbles.find((b) => b.event.side === 'long')!;
    const short = l.bubbles.find((b) => b.event.side === 'short')!;
    expect(long.r).toBeCloseTo(short.r);
    expect(long.r).toBeLessThan(BUBBLE_R_MAX);
  });

  it('what fits is drawn at full size, as before: a lone event and a spread day are not shrunk', () => {
    const spread = Array.from({ length: 12 }, (_, i) => ev(day.from + i * 7200 + 600, 4e6, i % 2 ? 'long' : 'short', i));
    const l = bubbleLayout(spread, day, { width: 1158, height: 140 });
    expect(defects(l, 1158, 140, 12)).toEqual([]);
    expect(l.bubbles.every((b) => b.r === BUBBLE_R_MAX)).toBe(true);
    expect(l.more).toEqual([]);
  });

  it('Market today: the captured 24h block (the e2e fixture) at 324 and 1158 px', () => {
    const block = liqFixture.block as unknown as { large: WebLiquidationLargeEvent[] };
    const win = { from: liqFixture.asOf - 86_400, to: liqFixture.asOf };
    for (const width of [324, 1158]) {
      const l = bubbleLayout(block.large, win, { width, height: 140 });
      expect(defects(l, width, 140, block.large.length)).toEqual([]);
      // its 26-print series fits at no radius: that must not shrink the whole chart to 3 px dots
      const top = Math.max(...l.bubbles.map((b) => b.r));
      expect(top).toBeCloseTo(BUBBLE_R_MAX * BUBBLE_MIN_SCALE);
      const biggest = l.bubbles.find((b) => b.event.usd === Math.max(...block.large.map((e) => e.usd)))!;
      expect(biggest.r).toBe(top); // the $1.7M long is still the biggest circle
      expect(l.more.length).toBeGreaterThan(0);
    }
  });

  it('a minimum-radius bubble is never shrunk below BUBBLE_R_MIN', () => {
    const events = Array.from({ length: 200 }, (_, i) => ev(day.to - 600, usdAt(i), 'short', i));
    const l = bubbleLayout(events, day, { width: 324, height: 140 });
    expect(Math.min(...l.bubbles.map((b) => b.r))).toBeGreaterThanOrEqual(BUBBLE_R_MIN);
  });
});

describe('moreMarks', () => {
  it('neighbours whose labels would touch merge; the count is kept and the label stays inside', () => {
    const marks = moreMarks([2, 3, 4, 100, 318], 320);
    expect(marks.reduce((n, m) => n + m.count, 0)).toBe(5);
    expect(marks.map((m) => m.count)).toEqual([3, 1, 1]);
    expect(marks[0].x).toBeGreaterThanOrEqual(moreWidth(3) / 2); // pushed in from the left edge
    expect(marks[2].x).toBeLessThanOrEqual(320 - moreWidth(1) / 2);
  });

  it('far apart, they stay separate at their own x', () => {
    expect(moreMarks([50, 200], 320)).toEqual([{ x: 50, count: 1 }, { x: 200, count: 1 }]);
  });
});
