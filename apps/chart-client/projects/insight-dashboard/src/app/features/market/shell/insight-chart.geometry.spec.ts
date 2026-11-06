import type { WebInsightChart } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { chartGeometry, decimalsOf, niceTicks, tickLabel, valueText, xLabels } from './insight-chart.geometry';


/**
 * IB-119 (market round 2 §3) — the chart's arithmetic: an axis a person reads (3–5 round ticks in the
 * unit), the reference line where the value is, the band's colours, the span named, the value printed.
 */
const NOW = Date.UTC(2026, 10, 5, 12) / 1000;
const H = 3_600;
const base = (o: Partial<WebInsightChart>): WebInsightChart => ({
  kind: 'lines', unit: 'pct', ref: 0, band: null, series: [], highlight: null, marks: [], span: { from: NOW - 24 * H, to: NOW }, ...o,
});
const pts = (values: number[], from: number, step: number) => values.map((value, i) => ({ time: from + i * step, value }));

describe('niceTicks: 3–5 round ticks that cover the data', () => {
  it.each([
    [-0.0332, 0.014], [0, 9_000_000], [-4.1, 1.8], [0.82, 2.4], [38, 62], [1.6e11, 1.62e11], [-0.2, -0.01], [5, 5], [0, 0],
  ])('[%d, %d]', (lo, hi) => {
    const t = niceTicks(lo, hi);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.length).toBeLessThanOrEqual(5);
    expect(t[0]).toBeLessThanOrEqual(Math.min(lo, hi));
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(Math.max(lo, hi));
    const steps = t.slice(1).map((v, i) => v - (t[i] as number));
    for (const s of steps) expect(s).toBeCloseTo(steps[0] as number, 9);
    const mant = (steps[0] as number) / 10 ** Math.floor(Math.log10(steps[0] as number));
    expect([1, 2, 2.5, 5].some((m) => Math.abs(m - mant) < 1e-9)).toBe(true);
  });
  it('the mockup\'s funding scale: steps of 0.01 %, zero among them', () => {
    expect(niceTicks(-0.0332, 0.014)).toEqual([-0.04, -0.02, 0, 0.02]);
  });
});

describe('labels in the unit, as precise as the step', () => {
  it('ticks', () => {
    expect([0.02, 0, -0.04].map((v) => tickLabel(v, 'pct', 0.02))).toEqual(['+0.02%', '0.00%', '−0.04%']);
    expect(tickLabel(-2_000_000, 'usd', 1_000_000, true)).toBe('$2M'); // a mirrored axis counts USD both ways
    expect(tickLabel(50, 'share', 25)).toBe('50%');
    expect(tickLabel(1.25, 'ratio', 0.25)).toBe('1.25');
    expect(decimalsOf(2.5)).toBe(1);
  });
  it('printed values: «−0.0332 %», «+1.8 %», «$3.1M», «1.40», «48 %»', () => {
    expect(valueText(-0.0332, 'pct')).toBe('−0.0332 %');
    expect(valueText(1.8, 'pct')).toBe('+1.8 %');
    expect(valueText(-4.1234, 'pct')).toBe('−4.1 %');
    expect(valueText(3_100_000, 'usd')).toBe('$3.1M');
    expect(valueText(1.4, 'ratio')).toBe('1.40');
    expect(valueText(48.4, 'share')).toBe('48 %');
    expect(valueText(52.21, 'index')).toBe('52.2');
  });
});

describe('the span on the x axis', () => {
  it('a span ending now reads back from now: «−24ч … −12ч … сейчас», «−30д … −15д … сейчас»', () => {
    expect(xLabels({ from: NOW - 24 * H, to: NOW }, NOW).map((l) => l.text)).toEqual([
      { kind: 'ago', unit: 'h', n: 24 }, { kind: 'ago', unit: 'h', n: 12 }, { kind: 'now' },
    ]);
    expect(xLabels({ from: NOW - 30 * 86_400, to: NOW - 600 }, NOW).map((l) => l.text)).toEqual([
      { kind: 'ago', unit: 'd', n: 30 }, { kind: 'ago', unit: 'd', n: 15 }, { kind: 'now' },
    ]);
    expect(xLabels({ from: NOW - H, to: NOW }, NOW)[0]?.text).toEqual({ kind: 'ago', unit: 'm', n: 60 });
  });
  it('a span in the past (a cascade, an alert) names its times in the viewer\'s zone (IB-152)', () => {
    expect(xLabels({ from: NOW - 5 * H, to: NOW - 5 * H + 40 * 60 }, NOW, 'UTC').map((l) => l.text)).toEqual([
      { kind: 'at', text: '07:00' }, { kind: 'at', text: '07:20' }, { kind: 'at', text: '07:40' },
    ]);
    expect(xLabels({ from: NOW - 5 * H, to: NOW - 5 * H + 40 * 60 }, NOW, 'Europe/Kyiv').map((l) => l.text)).toEqual([
      { kind: 'at', text: '09:00' }, { kind: 'at', text: '09:20' }, { kind: 'at', text: '09:40' },
    ]);
  });
});

describe('R5-style bars against a band: amber outside, muted inside, the current one marked', () => {
  const funding = [0.006, 0.01, -0.002, 0.012, 0.016, -0.006, -0.0332];
  const c = base({
    kind: 'bars', ref: 0, band: { lo: -0.004, hi: 0.014 }, series: [{ key: 'funding', points: pts(funding, NOW - 6 * 8 * H, 8 * H) }],
    highlight: { from: NOW, to: NOW }, span: { from: NOW - 6 * 8 * H, to: NOW },
  });
  const g = chartGeometry(c, NOW);
  it('outside the band is amber (out), inside muted (in)', () => {
    expect(g.bars.map((b) => b.tone)).toEqual(['in', 'in', 'in', 'in', 'out', 'out', 'out']);
  });
  it('bars grow from the zero line both ways; the band and the reference line sit where their values are', () => {
    const zero = g.ref?.y as number;
    const last = g.bars[6] as (typeof g.bars)[number];
    expect(last.top).toBeCloseTo(zero, 1); // a negative bar hangs from zero
    expect(g.bars[1]?.top).toBeLessThan(zero);
    expect((g.bars[1]?.top as number) + (g.bars[1]?.height as number)).toBeCloseTo(zero, 1);
    expect(g.band?.top).toBeLessThan(zero);
    expect((g.band?.top as number) + (g.band?.height as number)).toBeGreaterThan(zero);
  });
  it('the newest bar is lit and gets the "now" dot at its end; the corner prints it', () => {
    expect(g.bars.map((b) => b.lit)).toEqual([false, false, false, false, false, false, true]);
    expect(g.nowDot).toMatchObject({ tone: 'out' });
    expect(g.corner).toEqual({ focus: 'now', values: [{ key: 'funding', text: '−0.0332 %' }] });
    expect(g.ticks.map((t) => t.label)).toEqual(['+0.02%', '0.00%', '−0.02%', '−0.04%']);
  });
});

describe('R4-style lines: both from 0 on one axis, the last points marked', () => {
  const c = base({ series: [
    { key: 'price', points: pts([0, 0.4, 1.1, 1.8], NOW - 24 * H, 8 * H) },
    { key: 'oi', points: pts([0, -1.2, -3.9, -4.1], NOW - 24 * H, 8 * H) },
  ] });
  const g = chartGeometry(c, NOW);
  it('both lines start on the reference line; the corner prints both, the newest', () => {
    expect(g.lines.map((l) => l.key)).toEqual(['price', 'oi']);
    expect(g.lines.every((l) => l.d.startsWith(`M0 ${g.ref?.y}`))).toBe(true);
    expect(g.lines.map((l) => l.last.x)).toEqual([100, 100]);
    expect(g.corner.values).toEqual([{ key: 'price', text: '+1.8 %' }, { key: 'oi', text: '−4.1 %' }]);
    expect(g.ticks.length).toBeGreaterThanOrEqual(3);
  });
});

describe('mirrored liquidations: shorts above zero, longs below, the named side in colour', () => {
  const c = base({
    kind: 'bars_mirror', unit: 'usd', series: [
      { key: 'short', points: pts([1e6, 2e6, 8e6], NOW - 2 * H, H) },
      { key: 'long', points: pts([3e6, 1e6, 0], NOW - 2 * H, H) },
    ], highlight: { from: NOW, to: NOW }, span: { from: NOW - 2 * H, to: NOW },
  });
  it('the second series hangs below zero; its tick labels count USD, not negative USD', () => {
    const g = chartGeometry(c, NOW, 'short');
    const zero = g.ref?.y as number;
    expect(g.bars.slice(0, 3).every((b) => b.top + b.height <= zero + 0.01)).toBe(true);
    expect(g.bars.slice(3).every((b) => b.top >= zero - 0.01)).toBe(true);
    expect(g.ticks.map((t) => t.label).some((l) => l.includes('−'))).toBe(false);
    expect(g.bars.map((b) => b.tone)).toEqual(['named', 'named', 'named', 'other', 'other', 'other']);
    expect(chartGeometry(c, NOW, 'long').bars.map((b) => b.tone).slice(3)).toEqual(['named', 'named', 'named']);
  });
  it('a cascade (a highlighted RANGE) prints its sums per side', () => {
    const g = chartGeometry({ ...c, highlight: { from: NOW - H, to: NOW } }, NOW, 'short');
    expect(g.corner).toEqual({ focus: 'cascade', values: [{ key: 'short', text: '$10M' }, { key: 'long', text: '$1M' }] });
    expect(g.highlight?.width).toBeCloseTo(200 / 3, 1);
  });
});

describe('R11: A and B marked on both lines, the A–B stretch drawn over each', () => {
  const a = NOW - 20 * H;
  const b = NOW - 10 * H;
  const c = base({
    series: [
      { key: 'price', points: pts([0, -0.5, -1, -1.2, -1.8], a - 10 * H, 5 * H) },
      { key: 'oi', points: pts([0, 1, 2, 3, 3.2], a - 10 * H, 5 * H) },
    ],
    highlight: { from: a, to: b }, marks: [a, b], span: { from: a - 10 * H, to: a + 10 * H },
  });
  const g = chartGeometry(c, NOW);
  it('two marks with a dot on each line; two segments; the corner reads at B', () => {
    expect(g.marks.map((m) => [m.label, m.ys.length])).toEqual([['A', 2], ['B', 2]]);
    expect(g.segments.map((s) => s.key)).toEqual(['price', 'oi']);
    expect(g.corner).toEqual({ focus: 'b', values: [{ key: 'price', text: '−1.8 %' }, { key: 'oi', text: '+3.2 %' }] });
  });
});
