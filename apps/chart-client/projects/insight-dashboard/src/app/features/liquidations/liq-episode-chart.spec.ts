import type { WebLiquidationEpisode } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { AFTER_SEC, BEFORE_SEC, CHART_H, CHART_W, episodeChart } from './liq-episode-chart';

const FROM = 1_793_890_680; // a minute start
const ep = (over: Partial<WebLiquidationEpisode> = {}): Pick<WebLiquidationEpisode, 'from' | 'to' | 'perMinute' | 'price'> => ({
  from: FROM,
  to: FROM + 600,
  perMinute: [{ time: FROM, usd: 2e6 }, { time: FROM + 300, usd: 8e6 }, { time: FROM + 600, usd: 4e6 }],
  price: {
    symbol: 'BTCUSDT',
    points: [{ time: FROM - BEFORE_SEC, close: 100 }, { time: FROM, close: 110 }, { time: FROM + 600 + AFTER_SEC, close: 105 }],
    startOpen: 100, endClose: 110, after4hClose: 105,
  },
  ...over,
});

const xs = (line: string) => [...line.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe('episodeChart (IB-134, E6)', () => {
  it('spans from − 1 h to to + 4 h: the first close sits on the left edge, the +4 h close on the right', () => {
    const pts = xs(episodeChart(ep()).line!);
    expect(pts[0][0]).toBe(0);
    expect(pts.at(-1)![0]).toBe(CHART_W);
  });

  it('the highest close is at the top of the price band, the lowest at its bottom — above the bars', () => {
    const pts = xs(episodeChart(ep()).line!);
    expect(pts[1][1]).toBe(6); // 110, the high
    expect(pts[0][1]).toBe(56); // 100, the low
    expect(Math.max(...pts.map((p) => p[1]))).toBeLessThan(CHART_H - 32);
  });

  it('a path that has not reached +4 h ends early — the x axis does not stretch to fill the box', () => {
    const price = { ...ep().price!, points: ep().price!.points.slice(0, 2), after4hClose: null };
    const pts = xs(episodeChart(ep({ price })).line!);
    expect(pts.at(-1)![0]).toBeLessThan(CHART_W / 2);
  });

  it('no price → no line (the card says «нет цены»), but the shade and the bars are still drawn', () => {
    const c = episodeChart(ep({ price: null }));
    expect(c.line).toBeNull();
    expect(c.bars).toHaveLength(3);
    expect(c.shade.width).toBeGreaterThan(0);
  });

  it('a flat price is a level line in the middle, not a division by zero', () => {
    const price = { ...ep().price!, points: ep().price!.points.map((p) => ({ ...p, close: 50 })) };
    expect(xs(episodeChart(ep({ price })).line!).every((p) => p[1] === 31)).toBe(true);
  });

  it('bars: one per minute, the largest minute the tallest, bottom-aligned; the shade covers from → end of to\'s minute', () => {
    const c = episodeChart(ep());
    expect(c.bars.map((b) => b.height)).toEqual([8, 32, 16]);
    expect(c.bars.every((b) => b.y + b.height === CHART_H)).toBe(true);
    const span = BEFORE_SEC + 600 + AFTER_SEC;
    expect(c.shade.x).toBeCloseTo((BEFORE_SEC / span) * CHART_W, 0);
    expect(c.shade.x + c.shade.width).toBeCloseTo(((BEFORE_SEC + 660) / span) * CHART_W, 0);
    expect(c.bars.at(-1)!.x).toBeLessThan(c.shade.x + c.shade.width);
  });

  it('a `from` inside its minute: the axis starts at that minute − 60 min, so the first close is on the edge, not left of it', () => {
    const pts = xs(episodeChart(ep({ from: FROM + 37, to: FROM + 637 })).line!);
    expect(pts[0][0]).toBe(0);
    expect(pts.at(-1)![0]).toBe(CHART_W);
  });

  it('a single print is still visible: a minimum-width shade and bar', () => {
    const c = episodeChart(ep({ to: FROM, perMinute: [{ time: FROM, usd: 26e6 }] }));
    expect(c.bars).toHaveLength(1);
    expect(c.bars[0].width).toBeGreaterThanOrEqual(2);
    expect(c.shade.width).toBeGreaterThanOrEqual(2);
  });
});
