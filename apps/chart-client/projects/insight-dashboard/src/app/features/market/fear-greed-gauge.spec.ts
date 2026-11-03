import { FEAR_GREED_ZONES, type WebFearGreedReading } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { captionAnchor, gaugeGeometry, gaugePoint, historyLine, MIN_LINE_POINTS } from './fear-greed-gauge';

/** IB-102 — the gauge and the 30-day line as geometry; every case is one a wrong formula fails. */

const CX = 100;
const CY = 100;
const R = 80;

describe('gaugePoint / gaugeGeometry', () => {
  it('0 is the left end, 100 the right end, 50 straight up', () => {
    expect(gaugePoint(0, CX, CY, R)).toEqual({ x: 20, y: 100 });
    expect(gaugePoint(100, CX, CY, R)).toEqual({ x: 180, y: 100 });
    expect(gaugePoint(50, CX, CY, R)).toEqual({ x: 100, y: 20 });
  });

  it('a quarter of the way is 45° up from the left', () => {
    const p = gaugePoint(25, CX, CY, R);
    expect(p.x).toBeCloseTo(100 - 80 * Math.SQRT1_2, 1);
    expect(p.y).toBeCloseTo(100 - 80 * Math.SQRT1_2, 1);
  });

  it('clamps a reading outside 0–100 to the ends', () => {
    expect(gaugePoint(-10, CX, CY, R)).toEqual(gaugePoint(0, CX, CY, R));
    expect(gaugePoint(140, CX, CY, R)).toEqual(gaugePoint(100, CX, CY, R));
  });

  it('five arcs, one per contract zone, meeting at the zone edges and covering 0–100', () => {
    const g = gaugeGeometry(26, CX, CY, R);
    expect(g.arcs.map((a) => a.band)).toEqual(FEAR_GREED_ZONES.map((z) => z.band));
    const ends = [0, 24, 44, 55, 75, 100].map((v) => gaugePoint(v, CX, CY, R));
    g.arcs.forEach((arc, i) => {
      expect(arc.d.startsWith(`M ${ends[i].x} ${ends[i].y} `)).toBe(true);
      expect(arc.d.endsWith(` ${ends[i + 1].x} ${ends[i + 1].y}`)).toBe(true);
    });
  });

  it('the needle points at the reading, shorter than the arc', () => {
    const g = gaugeGeometry(50, CX, CY, R, 60);
    expect(g.needle).toEqual({ x: 100, y: 40 });
  });
});

const reading = (day: string, value: number): WebFearGreedReading => ({ day, value, classification: 'x' });
const days = (n: number, start = '2026-10-04') =>
  Array.from({ length: n }, (_, i) => reading(new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), 10 + i));

describe('historyLine', () => {
  it(`no line under ${MIN_LINE_POINTS} published days — no empty frame either`, () => {
    expect(historyLine(days(MIN_LINE_POINTS - 1), 300, 40)).toBeNull();
    expect(historyLine([], 300, 40)).toBeNull();
    expect(historyLine(undefined, 300, 40)).toBeNull(); // a server from before IB-102
  });

  it('from 7 days: first at x 0, last at the right edge, values mapped 0 → bottom, 100 → top', () => {
    const line = historyLine([reading('2026-10-01', 0), ...days(5, '2026-10-02'), reading('2026-10-07', 100)], 300, 40)!;
    const pts = line.points.split(' ');
    expect(pts[0]).toBe('0,40');
    expect(pts.at(-1)).toBe('300,0');
  });

  it('x is by DATE: a day the venue skipped stays a gap instead of being closed up', () => {
    // 7 published days over a 9-day span (two missed): the second point is 3 days in, not 1
    const rows = [reading('2026-10-01', 50), reading('2026-10-04', 50), ...days(5, '2026-10-05')];
    const line = historyLine(rows, 270, 40)!; // span 8 days → 33.75 px a day
    expect(line.points.split(' ')[1]).toBe(`${Math.round(3 * (270 / 8) * 100) / 100},20`);
  });

  it('marks the reading seven days before the newest, and only when that day was published', () => {
    const line = historyLine(days(10), 270, 40)!; // 9-day span, 30 px a day; newest 10-13, a week ago 10-06
    expect(line.weekAgoX).toBe(60);
    const gap = days(10).filter((r) => r.day !== '2026-10-06');
    expect(historyLine(gap, 270, 40)!.weekAgoX).toBeNull();
  });

  it('zone bands behind the line stack from 0 to 100 with the contract edges', () => {
    const line = historyLine(days(7), 300, 100)!;
    expect(line.bands.map((b) => b.band)).toEqual(FEAR_GREED_ZONES.map((z) => z.band));
    expect(line.bands.map((b) => b.height)).toEqual([24, 20, 11, 20, 25]);
    expect(line.bands.map((b) => b.y)).toEqual([76, 56, 45, 25, 0]);
  });

  it('accepts the history in any order (it is drawn oldest → newest)', () => {
    const rows = days(8);
    expect(historyLine([...rows].reverse(), 300, 40)).toEqual(historyLine(rows, 300, 40));
  });
});

describe('captionAnchor — «a week ago» sits under its mark', () => {
  it('starts at the mark when there is room to its right', () => {
    expect(captionAnchor(60, 300)).toEqual({ side: 'left', pct: 20 });
  });

  it('ends at the mark near the right edge instead of running off it', () => {
    expect(captionAnchor(270, 300)).toEqual({ side: 'right', pct: 10 });
  });
});
