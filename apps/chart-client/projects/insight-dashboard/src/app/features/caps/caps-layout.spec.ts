import type { WebCapsCoin, WebCapsDominance } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import { ru } from '../../i18n/ru';
import { bigTile, capsScale, changeColour, changeScale, dominanceSegments, NEUTRAL_TILE, segmentLabelFits, squarify, tileText } from './caps-layout';

/** IB-090 — the caps block's geometry: squarify, the colour scale, the dominance bar. */
const caps = [1560, 280, 91.7, 81, 55, 20.7, 20.4, 11.8, 8.5, 7.2, 5, 4.4, 3.7, 2.6, 2.3, 2.1, 2, 1.4, 1.1, 0.45];
const rect = { x: 0, y: 0, w: 342, h: 220 };

describe('squarify', () => {
  it('the areas sum to the container, each exactly proportional to its value', () => {
    const tiles = squarify(caps, (v) => v, rect);
    const total = caps.reduce((a, b) => a + b, 0);
    expect(tiles.reduce((s, t) => s + t.w * t.h, 0)).toBeCloseTo(rect.w * rect.h, 6);
    for (const t of tiles) expect(t.w * t.h).toBeCloseTo((t.item / total) * rect.w * rect.h, 6);
  });

  it('every tile inside the container, none overlapping another', () => {
    const tiles = squarify(caps, (v) => v, rect);
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(-1e-9);
      expect(t.y).toBeGreaterThanOrEqual(-1e-9);
      expect(t.x + t.w).toBeLessThanOrEqual(rect.w + 1e-9);
      expect(t.y + t.h).toBeLessThanOrEqual(rect.h + 1e-9);
    }
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i]; const b = tiles[j];
      const overlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      expect(overlap).toBeLessThan(1e-6);
    }
  });

  it('stable order: input order kept, and the same input gives the same tiles', () => {
    const a = squarify(caps, (v) => v, rect);
    const b = squarify([...caps], (v) => v, rect);
    expect(a.map((t) => t.item)).toEqual(caps);
    expect(b).toEqual(a);
  });

  it('squarified, not sliced: the biggest coins are near-square, not slivers', () => {
    const tiles = squarify(caps, (v) => v, rect);
    const aspect = (t: { w: number; h: number }) => Math.max(t.w / t.h, t.h / t.w);
    expect(aspect(tiles[0])).toBeLessThan(2.5);
    expect(aspect(tiles[1])).toBeLessThan(3);
  });

  it('nothing to lay out is no tiles, not a crash', () => {
    expect(squarify([], (v: number) => v, rect)).toEqual([]);
    expect(squarify([0, -1], (v) => v, rect)).toEqual([]);
  });
});

describe('colour — symmetric around 0', () => {
  it('+x and −x are equally strong, green and red; 0 and null are neutral', () => {
    const up = changeColour(2, 4);
    const down = changeColour(-2, 4);
    const strength = (c: string, base = [33, 38, 45]) => c.match(/\d+/g)!.map(Number).reduce((s, v, i) => s + Math.abs(v - base[i]), 0);
    expect(up).toMatch(/^rgb\(/);
    expect(up).not.toBe(down);
    expect(strength(up) / strength(changeColour(4, 4))).toBeCloseTo(strength(down) / strength(changeColour(-4, 4)), 1);
    expect([changeColour(0, 4), changeColour(null, 4)]).toEqual([NEUTRAL_TILE, NEUTRAL_TILE]);
    expect(changeColour(9, 4)).toBe(changeColour(4, 4)); // clipped at the scale's end
    expect(changeColour(4, 4)).toBe('rgb(31, 138, 126)'); // IB-108: the mockup's #1f8a7e
    expect(changeColour(-4, 4)).toBe('rgb(179, 48, 44)'); // IB-108: the mockup's #b3302c
    expect(changeColour(0.02, 1)).toBe('rgb(33, 40, 47)'); // a non-move stays next to neutral
  });

  it('the scale is ±max |change|, whole percent, at least 1 %; stablecoins do not set it', () => {
    expect([changeScale([0.2, -0.4]), changeScale([2.3, -4.1, null]), changeScale([])]).toEqual([1, 5, 1]);
    const coin = (changePct: number, stable = false) => ({ changePct, stable }) as WebCapsCoin;
    expect(capsScale([coin(1.5), coin(-6, true)])).toBe(2);
  });

  it('IB-108: by the label itself — the whole ticker and change, the ticker alone, or nothing; never a cut text', () => {
    const label = { symbol: 'HYPE', change: '−2.63 %' }; // ticker 32.8 px, change 51.1 px, 6 px each side
    expect(tileText({ x: 0, y: 0, w: 64, h: 40 }, label)).toBe('full');
    expect(tileText({ x: 0, y: 0, w: 62, h: 40 }, label)).toBe('ticker'); // the change would be cut
    expect(tileText({ x: 0, y: 0, w: 64, h: 39 }, label)).toBe('ticker'); // no second line's height
    expect(tileText({ x: 0, y: 0, w: 46, h: 22 }, label)).toBe('ticker');
    expect(tileText({ x: 0, y: 0, w: 70, h: 30 }, { symbol: 'FIGR_HELOC', change: '−0.83 %' })).toBe('none'); // 82 px of ticker
    expect(tileText({ x: 0, y: 0, w: 40, h: 21 }, label)).toBe('none');
  });

  it('a tile shows ticker and change, ticker only, or nothing, by its size', () => {
    expect([tileText({ x: 0, y: 0, w: 60, h: 40 }), tileText({ x: 0, y: 0, w: 34, h: 18 }), tileText({ x: 0, y: 0, w: 12, h: 12 })]).toEqual(['full', 'ticker', 'none']);
  });
});

describe('dominanceSegments', () => {
  const d: WebCapsDominance = { btcPct: 59.3, ethPct: 10.6, stablesPct: 7.9, restPct: 22.2, totalCapUsd: 2.6e12, totalCapChangePct24h: -2.3, stablesCounted: 12, asOf: '2026-11-03T17:00:00Z' };
  it('BTC, ETH, stables, rest — left to right, edges cumulative, ending at 100', () => {
    const s = dominanceSegments(d);
    expect(s.map((x) => x.key)).toEqual(['caps.dominance.btc', 'caps.dominance.eth', 'caps.dominance.stables', 'caps.dominance.rest']);
    expect(s.map((x) => x.left)).toEqual([0, 59.3, 69.9, 77.8].map((v) => expect.closeTo(v, 6)));
    expect(s.at(-1)!.left + s.at(-1)!.pct).toBeCloseTo(100, 6);
    for (const t of [ru, en]) for (const x of s) expect((t as Record<string, string>)[x.key], x.key).toBeTruthy();
  });

  it('IB-108: ink that reads on each fill', () => {
    expect(dominanceSegments(d).map((x) => x.ink)).toEqual(['dark', 'dark', 'light', 'light']);
  });
});

describe('segmentLabelFits (IB-108, TL review)', () => {
  it('the whole label fits the segment at the bar’s width, or there is none — at 390 «стейблкоины 11.0 %» does not', () => {
    // a phone's bar: 358 px. «BTC 59.5 %» (10 chars → 86 px) in 213 px: fits
    expect(segmentLabelFits('BTC 59.5 %', 59.5, 358)).toBe(true);
    // «ETH 10.9 %» needs 86 px, 10.9 % of 358 is 39 px: no — the borderline the review saw
    expect(segmentLabelFits('ETH 10.9 %', 10.9, 358)).toBe(false);
    expect(segmentLabelFits('стейблкоины 11.0 %', 11, 358)).toBe(false);
    expect(segmentLabelFits('остальные 18.6 %', 18.6, 358)).toBe(false);
    // the same labels on a 1328 px desktop bar all fit
    for (const [text, pct] of [['ETH 10.9 %', 10.9], ['стейблкоины 11.0 %', 11], ['остальные 18.6 %', 18.6]] as const) {
      expect(segmentLabelFits(text, pct, 1328)).toBe(true);
    }
  });

  it('the edge: exactly the text plus its padding fits; one pixel less does not', () => {
    const need = 10 * 7.4 + 12; // 86 px
    expect(segmentLabelFits('BTC 59.5 %', 100, need)).toBe(true);
    expect(segmentLabelFits('BTC 59.5 %', 100, need - 1)).toBe(false);
  });
});

describe('bigTile (IB-108)', () => {
  it('the two largest coins, and only when the tile has room for the big label', () => {
    const roomy = { x: 0, y: 0, w: 200, h: 120 };
    expect([0, 1, 2].map((i) => bigTile(i, roomy))).toEqual([true, true, false]);
    expect(bigTile(0, { x: 0, y: 0, w: 109, h: 120 })).toBe(false);
    expect(bigTile(1, { x: 0, y: 0, w: 200, h: 71 })).toBe(false);
  });
});
