import type { WebKpiHistory } from '@trade-automation/contracts';

/**
 * IB-118 (market round 2 §2) — a KPI tile's 7-day mini chart, pure. Every coordinate is a PERCENT of
 * the chart box (x from the left, y from the top), so the line is an SVG path in a 0–100 viewBox
 * stretched to the tile, and the dots and bars are HTML placed by percent: a dot stays round however
 * wide the tile is.
 *
 * `area` (market cap, BTC OI): x by TIME, so a gap is a gap; two neighbours further apart than the
 * history's `breakAfterSec` are not joined (the line breaks, nothing is interpolated). Dots on the
 * min and the max (the very points that hold `min`/`max`) and on the newest point; the tone is the
 * 7-day move, newest against oldest.
 *
 * `bars` (BTC funding): one bar per settlement, by index, around a zero line: above zero longs pay
 * (amber), below shorts pay (blue). The newest bar is lit.
 *
 * `lines` (IB-131, BTC dominance): two strips stacked, BTC (`points`) above and ETH (`second`) below,
 * each on ITS OWN scale — at 57 % and 11 % a shared axis would draw a week's 1-point move flat. Both
 * share the x axis (`from`/`to`) and the break rule; each has its min / max dots and the newest marked.
 */
export interface KpiDot {
  x: number;
  y: number;
}

export interface KpiAreaGeometry {
  kind: 'area';
  /** One path pair per unbroken run: `line` is the stroke, `area` the same run closed to the bottom. */
  segments: Array<{ line: string; area: string }>;
  min: KpiDot;
  max: KpiDot;
  last: KpiDot;
  /** Newest against oldest point: red when down over the span, green when up. */
  tone: 'up' | 'down' | 'flat';
}

export interface KpiBar {
  /** Left edge and width, % of the box. */
  x: number;
  width: number;
  /** Top edge and height, % of the box. */
  top: number;
  height: number;
  side: 'longs_pay' | 'shorts_pay' | 'flat';
  lit: boolean;
}

export interface KpiBarsGeometry {
  kind: 'bars';
  /** The zero line, % from the top. */
  zero: number;
  bars: KpiBar[];
}

/** One strip of a `lines` chart: its runs (a path each), and its own min / max / newest dots. */
export interface KpiLineStrip {
  segments: string[];
  min: KpiDot;
  max: KpiDot;
  last: KpiDot;
}

export interface KpiLinesGeometry {
  kind: 'lines';
  /** Top (BTC, the tile's value) then bottom (ETH). */
  strips: [KpiLineStrip, KpiLineStrip];
}

export type KpiChartGeometry = KpiAreaGeometry | KpiBarsGeometry | KpiLinesGeometry;

/** Room above the max and below the min, so a dot is never cut in half by the box edge. */
export const PAD_PCT = 10;
/** The gap between two bars, as a share of a bar's slot. */
const BAR_GAP_SHARE = 0.25;

/**
 * `undefined` too (IB-BUG-038): a payload from a server older than IB-118 — or a fixture captured before
 * it — has no `history` at all. Absent is "no series", the same as null, never a crash of the page.
 */
export function kpiChartGeometry(history: WebKpiHistory | null | undefined): KpiChartGeometry | null {
  if (history == null || history.points.length === 0) return null;
  switch (history.kind) {
    case 'area': return area(history);
    case 'bars': return bars(history);
    // a `lines` without its second line cannot be drawn as two strips; the contract refuses it anyway
    case 'lines': return history.second ? lines(history, history.second) : null;
  }
}

type Points = WebKpiHistory['points'];

/** One line in a 0–100 box: x by time over `from`–`to`, y over its own `min`–`max`, runs split by the break rule. */
function trace(pts: Points, h: Pick<WebKpiHistory, 'from' | 'to' | 'breakAfterSec'>, min: number, max: number) {
  const span = h.to - h.from;
  const range = max - min;
  const x = (t: number) => (span === 0 ? 100 : ((t - h.from) / span) * 100);
  const y = (v: number) => (range === 0 ? 50 : PAD_PCT + ((max - v) / range) * (100 - 2 * PAD_PCT));
  const dot = (i: number): KpiDot => ({ x: r(x(pts[i].time)), y: r(y(pts[i].value)) });

  const runs: number[][] = [];
  pts.forEach((p, i) => {
    const joined = i > 0 && (h.breakAfterSec === null || p.time - pts[i - 1].time <= h.breakAfterSec);
    if (joined) runs[runs.length - 1].push(i);
    else runs.push([i]);
  });
  const segments = runs.map((run) => {
    const line = run.map((i, k) => `${k === 0 ? 'M' : 'L'}${r(x(pts[i].time))} ${r(y(pts[i].value))}`).join(' ');
    const x0 = r(x(pts[run[0]].time));
    const x1 = r(x(pts[run[run.length - 1]].time));
    return { line, area: `${line} L${x1} 100 L${x0} 100 Z` };
  });
  return {
    segments,
    min: dot(pts.findIndex((p) => p.value === min)),
    max: dot(pts.findIndex((p) => p.value === max)),
    last: dot(pts.length - 1),
  };
}

function area(h: WebKpiHistory): KpiAreaGeometry {
  const pts = h.points;
  const first = pts[0].value;
  const lastValue = pts[pts.length - 1].value;
  return {
    kind: 'area',
    ...trace(pts, h, h.min, h.max),
    tone: lastValue > first ? 'up' : lastValue < first ? 'down' : 'flat',
  };
}

function lines(h: WebKpiHistory, second: NonNullable<WebKpiHistory['second']>): KpiLinesGeometry {
  const strip = (pts: Points, min: number, max: number): KpiLineStrip => {
    const t = trace(pts, h, min, max);
    return { segments: t.segments.map((s) => s.line), min: t.min, max: t.max, last: t.last };
  };
  return { kind: 'lines', strips: [strip(h.points, h.min, h.max), strip(second.points, second.min, second.max)] };
}

function bars(h: WebKpiHistory): KpiBarsGeometry {
  const pts = h.points;
  const hi = Math.max(0, h.max);
  const lo = Math.min(0, h.min);
  const range = hi - lo;
  const usable = 100 - 2 * PAD_PCT;
  const zero = range === 0 ? 50 : PAD_PCT + (hi / range) * usable;
  const slot = 100 / pts.length;
  const width = slot * (1 - BAR_GAP_SHARE);
  return {
    kind: 'bars',
    zero: r(zero),
    bars: pts.map((p, i) => {
      const height = range === 0 ? 0 : (Math.abs(p.value) / range) * usable;
      return {
        x: r(i * slot + (slot - width) / 2),
        width: r(width),
        top: r(p.value >= 0 ? zero - height : zero),
        height: r(height),
        side: p.value > 0 ? 'longs_pay' : p.value < 0 ? 'shorts_pay' : 'flat',
        lit: i === pts.length - 1,
      };
    }),
  };
}

const r = (v: number) => Math.round(v * 100) / 100;
