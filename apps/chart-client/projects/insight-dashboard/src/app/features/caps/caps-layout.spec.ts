import type { WebCapsCoin, WebCapsDominance } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import { ru } from '../../i18n/ru';
import { capsScale, changeColour, changeScale, dominanceSegments, NEUTRAL_TILE, squarify, tileText } from './caps-layout';

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
    expect(changeColour(4, 4)).toBe('rgb(38, 166, 154)');
    expect(changeColour(-4, 4)).toBe('rgb(239, 83, 80)');
    expect(changeColour(0.02, 1)).toBe('rgb(33, 41, 47)'); // a non-move stays next to neutral
  });

  it('the scale is ±max |change|, whole percent, at least 1 %; stablecoins do not set it', () => {
    expect([changeScale([0.2, -0.4]), changeScale([2.3, -4.1, null]), changeScale([])]).toEqual([1, 5, 1]);
    const coin = (changePct: number, stable = false) => ({ changePct, stable }) as WebCapsCoin;
    expect(capsScale([coin(1.5), coin(-6, true)])).toBe(2);
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
});
