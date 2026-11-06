import { dayMonth, timeOfDay, type Zone } from '../../../shared/time-format';
import type { WebInsightChart, WebInsightChartPoint } from '@trade-automation/contracts';
import { formatUsd } from '../../liquidations/liquidations.format';

/**
 * IB-119 (market round 2 §3) — the insight card's chart, PURE: the server's `WebInsightChart` → what
 * the SVG and its HTML labels draw. Coordinates are percent of the plot box (x 0 = span start, 100 =
 * span end; y 0 = top), so the component can stretch the plot to any card width and keep the text
 * crisp. Every chart answers the owner's «не информативная инфографика»: a y axis with 3–5 ticks in
 * the series' unit, the reference line, the span named on the x axis, the current value printed.
 */

const MINUS = '−';

/** Ticks a person reads: steps of 1, 2, 2.5 or 5 × 10ⁿ, at most `max` of them, covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, max = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0];
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo) {
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1;
    lo -= pad;
    hi += pad;
  }
  const raw = (hi - lo) / (max - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10, 20]) {
    const step = m * mag;
    const from = Math.floor(lo / step + 1e-9) * step;
    const to = Math.ceil(hi / step - 1e-9) * step;
    const n = Math.round((to - from) / step) + 1;
    if (n <= max) {
      const ticks = Array.from({ length: n }, (_, i) => clean(from + i * step, step));
      // at least 3 ticks, so the scale is readable: widen by a step at the end farther from the data
      while (ticks.length < 3) {
        const top = ticks[ticks.length - 1] as number;
        const bottom = ticks[0] as number;
        if (top - hi <= lo - bottom) ticks.push(clean(top + step, step));
        else ticks.unshift(clean(bottom - step, step));
      }
      return ticks;
    }
  }
  return [lo, hi];
}
const clean = (v: number, step: number) => {
  const d = decimalsOf(step);
  const r = Number(v.toFixed(d));
  return r === 0 ? 0 : r; // no −0
};

/** Digits after the point a step needs: 0.25 → 2, 0.01 → 2, 5 → 0. */
export function decimalsOf(step: number): number {
  for (let d = 0; d < 10; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-6) return d;
  return 10;
}

const signed = (v: number, text: string) => `${v > 0 ? '+' : v < 0 ? MINUS : ''}${text}`;

/** A tick label: in the unit, as precise as the step (no false precision, no lost digit). */
export function tickLabel(v: number, unit: WebInsightChart['unit'], step: number, mirror = false): string {
  const d = decimalsOf(step);
  const abs = Math.abs(v);
  switch (unit) {
    case 'pct': return `${signed(v, abs.toFixed(d))}%`;
    case 'share': return `${abs.toFixed(d)}%`;
    case 'usd': return formatUsd(mirror ? abs : v).replace('-', MINUS);
    default: return `${v < 0 ? MINUS : ''}${abs.toFixed(d)}`;
  }
}

/** A printed value («сейчас −0.0332 %»): three significant digits below 1, one decimal above. */
export function valueText(v: number, unit: WebInsightChart['unit']): string {
  const abs = Math.abs(v);
  const sig = (x: number) => {
    if (x === 0) return '0';
    const d = x >= 1 ? 1 : Math.min(8, 2 - Math.floor(Math.log10(x)));
    return x.toFixed(d).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  };
  switch (unit) {
    case 'pct': return `${signed(v, sig(abs))} %`;
    case 'share': return `${Math.round(abs)} %`;
    case 'usd': return formatUsd(v).replace('-', MINUS);
    case 'ratio': return abs.toFixed(2);
    default: return `${v < 0 ? MINUS : ''}${abs.toFixed(1)}`;
  }
}

/** The x axis: span start, middle and end — relative («−24ч … сейчас») when the span ends now, else the viewer's times (IB-152). */
export type XLabel = { x: number; text: { kind: 'now' } | { kind: 'ago'; unit: 'd' | 'h' | 'm'; n: number } | { kind: 'at'; text: string } };

export function xLabels(span: { from: number; to: number }, nowSec: number, zone?: Zone): XLabel[] {
  const len = Math.max(1, span.to - span.from);
  const live = nowSec - span.to <= Math.max(300, len * 0.1);
  const at = (t: number) => (len > 2 * 86_400 ? dayMonth(t, zone) : timeOfDay(t, zone));
  return [0, 50, 100].map((x) => {
    const t = span.from + (len * x) / 100;
    if (!live) return { x, text: { kind: 'at' as const, text: at(t) } };
    if (x === 100) return { x, text: { kind: 'now' as const } };
    const ago = nowSec - t;
    if (len >= 2 * 86_400) return { x, text: { kind: 'ago' as const, unit: 'd' as const, n: Math.round(ago / 86_400) } };
    if (len >= 2 * 3_600) return { x, text: { kind: 'ago' as const, unit: 'h' as const, n: Math.round(ago / 3_600) } };
    return { x, text: { kind: 'ago' as const, unit: 'm' as const, n: Math.round(ago / 60) } };
  });
}

export type BarTone = 'out' | 'in' | 'up' | 'down' | 'named' | 'other';

export interface ChartGeometry {
  kind: WebInsightChart['kind'];
  ticks: Array<{ y: number; label: string }>;
  ref: { y: number } | null;
  band: { top: number; height: number } | null;
  bars: Array<{ key: string; x: number; width: number; top: number; height: number; tone: BarTone; lit: boolean }>;
  lines: Array<{ key: string; d: string; last: { x: number; y: number } }>;
  /** R11: the A–B stretch of each line, drawn over it in the direction's colour, and the A and B dots. */
  segments: Array<{ key: string; d: string }>;
  marks: Array<{ x: number; ys: number[]; label: 'A' | 'B' }>;
  /** The highlighted moment or range: a light column behind the data (a moment gets a hairline). */
  highlight: { x: number; width: number } | null;
  /** The newest bar's marker when it is the statement's "now" (R2, R5): a dot at the bar's end. */
  nowDot: { x: number; y: number; tone: BarTone } | null;
  xLabels: XLabel[];
  /** What the corner prints: per series, the value at the chart's focus (now, the cascade, B). */
  corner: { focus: 'now' | 'cascade' | 'b'; values: Array<{ key: string; text: string }> };
}

/**
 * The geometry. `namedSide` colours R1/R3's mirrored bars (the side the statement is about in its
 * colour, the other muted); bars against a band are amber outside it, muted inside — outside the band
 * is exactly what the rule calls rare (the server takes the band from the rarity's own sample).
 */
export function chartGeometry(c: WebInsightChart, nowSec: number, namedSide: 'long' | 'short' | null = null): ChartGeometry {
  const mirror = c.kind === 'bars_mirror';
  const signedOf = (si: number, v: number) => (mirror && si === 1 ? -Math.abs(v) : mirror ? Math.abs(v) : v);
  const values = c.series.flatMap((s, si) => s.points.map((p) => signedOf(si, p.value)));
  const extra = [...(c.ref === null ? [] : [c.ref]), ...(c.band ? [c.band.lo, c.band.hi] : []), ...(c.kind === 'lines' ? [] : [0])];
  const ticks = niceTicks(Math.min(...values, ...extra), Math.max(...values, ...extra));
  const lo = ticks[0] as number;
  const hi = ticks[ticks.length - 1] as number;
  const step = ticks.length > 1 ? (ticks[1] as number) - lo : 1;
  const y = (v: number) => (hi === lo ? 50 : ((hi - v) / (hi - lo)) * 100);
  const len = Math.max(1, c.span.to - c.span.from);
  const x = (t: number) => Math.min(100, Math.max(0, ((t - c.span.from) / len) * 100));
  const r = (n: number) => Math.round(n * 100) / 100;

  const g: ChartGeometry = {
    kind: c.kind,
    // top to bottom, as the axis reads
    ticks: [...ticks].reverse().map((t) => ({ y: r(y(t)), label: tickLabel(t, c.unit, step, mirror) })),
    ref: c.ref === null ? null : { y: r(y(c.ref)) },
    band: c.band ? { top: r(y(c.band.hi)), height: r(y(c.band.lo) - y(c.band.hi)) } : null,
    bars: [], lines: [], segments: [], marks: [], highlight: null, nowDot: null,
    xLabels: xLabels(c.span, nowSec),
    corner: corner(c),
  };

  const lit = (t: number) => c.highlight !== null && t >= c.highlight.from && t <= c.highlight.to;
  if (c.kind === 'lines') {
    for (const s of c.series) {
      const pts = s.points.map((p) => ({ x: r(x(p.time)), y: r(y(p.value)) }));
      const last = pts[pts.length - 1] as { x: number; y: number };
      g.lines.push({ key: s.key, d: path(pts), last });
      if (c.marks.length === 2) {
        const [a, b] = c.marks as [number, number];
        const seg = s.points.filter((p) => p.time >= a && p.time <= b).map((p) => ({ x: r(x(p.time)), y: r(y(p.value)) }));
        if (seg.length >= 2) g.segments.push({ key: s.key, d: path(seg) });
      }
    }
    g.marks = c.marks.map((t, i) => ({
      x: r(x(t)), label: i === 0 ? 'A' as const : 'B' as const,
      ys: c.series.flatMap((s) => { const p = nearest(s.points, t); return p ? [r(y(p.value))] : []; }),
    }));
    if (c.highlight && c.highlight.from !== c.highlight.to) g.highlight = { x: r(x(c.highlight.from)), width: r(x(c.highlight.to) - x(c.highlight.from)) };
    return g;
  }

  // bars: one slot per point (the server's points are evenly spaced, the "now" point last), so the
  // bars never overlap and a late "now" bar is still a bar
  const n = Math.max(...c.series.map((s) => s.points.length));
  const slot = 100 / n;
  const width = r(slot * (n > 60 ? 0.8 : 0.7));
  const zero = y(0);
  c.series.forEach((s, si) => s.points.forEach((p, i) => {
    const v = signedOf(si, p.value);
    const top = Math.min(y(v), zero);
    const tone: BarTone = mirror
      ? (namedSide === null || (si === 0 ? 'short' : 'long') === namedSide ? 'named' : 'other')
      : c.band ? (p.value < c.band.lo || p.value > c.band.hi ? 'out' : 'in')
        : p.value >= 0 ? 'up' : 'down';
    g.bars.push({ key: s.key, x: r(i * slot + (slot - width) / 2), width, top: r(top), height: r(Math.max(Math.abs(y(v) - zero), 0.6)), tone, lit: lit(p.time) });
  }));
  if (c.highlight) {
    const idx = c.series[0]?.points.map((p, i) => (lit(p.time) ? i : -1)).filter((i) => i >= 0) ?? [];
    if (idx.length > 0) g.highlight = { x: r((idx[0] as number) * slot), width: r((idx.length) * slot) };
    const last = c.series[0]?.points[c.series[0].points.length - 1];
    if (!mirror && last && c.highlight.from === c.highlight.to && last.time === c.highlight.to) {
      const b = g.bars[g.bars.length - 1] as ChartGeometry['bars'][number];
      g.nowDot = { x: r(b.x + b.width / 2), y: r(y(last.value)), tone: b.tone };
    }
  }
  return g;
}

function corner(c: WebInsightChart): ChartGeometry['corner'] {
  const text = (v: number) => valueText(v, c.unit);
  if (c.kind === 'bars_mirror' && c.highlight && c.highlight.from !== c.highlight.to) {
    const h = c.highlight;
    return { focus: 'cascade', values: c.series.map((s) => ({ key: s.key, text: text(s.points.filter((p) => p.time >= h.from && p.time <= h.to).reduce((a, p) => a + p.value, 0)) })) };
  }
  if (c.marks.length === 2) {
    const b = c.marks[1] as number;
    return { focus: 'b', values: c.series.flatMap((s) => { const p = nearest(s.points, b); return p ? [{ key: s.key, text: text(p.value) }] : []; }) };
  }
  return { focus: 'now', values: c.series.map((s) => ({ key: s.key, text: text((s.points[s.points.length - 1] as WebInsightChartPoint).value) })) };
}

function nearest(points: readonly WebInsightChartPoint[], t: number): WebInsightChartPoint | null {
  let best: WebInsightChartPoint | null = null;
  for (const p of points) if (best === null || Math.abs(p.time - t) < Math.abs(best.time - t)) best = p;
  return best;
}

const path = (pts: ReadonlyArray<{ x: number; y: number }>) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
