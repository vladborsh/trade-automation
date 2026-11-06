import { utcDayKey } from '../../shared/time-format';
import { FEAR_GREED_ZONES, type FearGreedBand, type WebFearGreedReading } from '@trade-automation/contracts';

/**
 * IB-102 — the Fear & Greed gauge and its 30-day line, as pure geometry (the component only draws).
 *
 * The gauge is a semicircle over 0–100: 0 at the left end, 100 at the right, 50 straight up. Its five
 * arcs are the contract's zones (`FEAR_GREED_ZONES`, the table the bot's `fngBand` reads too), drawn
 * on a continuous scale: 0–24, 24–44, 44–55, 55–75, 75–100.
 */

export interface Point {
  x: number;
  y: number;
}

export interface GaugeGeometry {
  /** The needle's tip for the reading. */
  needle: Point;
  centre: Point;
  /** One SVG arc path per zone, in zone order. */
  arcs: Array<{ band: FearGreedBand; d: string }>;
}

/** Clamp to 0–100 and map to the semicircle: angle π at 0 (left), π/2 at 50 (up), 0 at 100 (right). */
export function gaugePoint(value: number, cx: number, cy: number, r: number): Point {
  const v = Math.max(0, Math.min(100, value));
  const angle = Math.PI * (1 - v / 100);
  return { x: round(cx + r * Math.cos(angle)), y: round(cy - r * Math.sin(angle)) };
}

export function gaugeGeometry(value: number, cx: number, cy: number, r: number, needleR = r * 0.82): GaugeGeometry {
  let from = 0;
  const arcs = FEAR_GREED_ZONES.map((zone) => {
    const a = gaugePoint(from, cx, cy, r);
    const b = gaugePoint(zone.upTo, cx, cy, r);
    from = zone.upTo;
    // sweep-flag 1: clockwise in SVG's y-down space, i.e. from the left end over the top to the right
    return { band: zone.band, d: `M ${a.x} ${a.y} A ${r} ${r} 0 0 1 ${b.x} ${b.y}` };
  });
  return { needle: gaugePoint(value, cx, cy, needleR), centre: { x: cx, y: cy }, arcs };
}

/** The line is drawn only from this many published days; fewer is no line, not an empty frame. */
export const MIN_LINE_POINTS = 7;

export interface HistoryLine {
  /** `points` attribute of the polyline. */
  points: string;
  /** Horizontal zone bands behind the line, top (greed) to bottom (fear). */
  bands: Array<{ band: FearGreedBand; y: number; height: number }>;
  /** The x of the reading seven days before the newest, when that day was published. */
  weekAgoX: number | null;
}

const DAY_MS = 86_400_000;
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

/**
 * The 30-day line. x is by DATE, not by index, so a day the venue did not publish stays a visible
 * gap in spacing rather than being closed up as if it had happened.
 */
export function historyLine(history: readonly WebFearGreedReading[] | null | undefined, width: number, height: number): HistoryLine | null {
  const rows = [...(history ?? [])].sort((a, b) => a.day.localeCompare(b.day));
  if (rows.length < MIN_LINE_POINTS) return null;
  const first = dayMs(rows[0].day);
  const span = Math.max(1, (dayMs(rows[rows.length - 1].day) - first) / DAY_MS);
  const x = (day: string) => round(((dayMs(day) - first) / DAY_MS / span) * width);
  const y = (value: number) => round(height - (Math.max(0, Math.min(100, value)) / 100) * height);
  let lower = 0;
  const bands = FEAR_GREED_ZONES.map((zone) => {
    const band = { band: zone.band, y: y(zone.upTo), height: round(((zone.upTo - lower) / 100) * height) };
    lower = zone.upTo;
    return band;
  });
  const newest = rows[rows.length - 1].day;
  const weekAgoDay = utcDayKey((dayMs(newest) - 7 * DAY_MS) / 1000);
  const weekAgo = rows.find((r) => r.day === weekAgoDay);
  return {
    points: rows.map((r) => `${x(r.day)},${y(r.value)}`).join(' '),
    bands,
    weekAgoX: weekAgo ? x(weekAgo.day) : null,
  };
}

/**
 * Where the «a week ago» caption sits under its mark, as a CSS percentage of the line's width: it
 * starts at the mark, unless that would run off the right edge, in which case it ends at the mark.
 */
export function captionAnchor(markX: number, width: number): { side: 'left' | 'right'; pct: number } {
  const pct = round((Math.max(0, Math.min(width, markX)) / width) * 100);
  return pct <= 60 ? { side: 'left', pct } : { side: 'right', pct: round(100 - pct) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
