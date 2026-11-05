import type { WebPositioningResponse, WebPositioningRow } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import captured from '../../../../../../e2e-insight-dashboard/fixtures/market-positioning.24h.json';
import {
  BULK_FLOOR, bulkDomain, compactPct, dataAt, type Domain, fullDomain, nearestRank, originInView, pan, panByPx, QUADRANT_PAD, sameDomain,
  zoom, ZOOM_MIN_HALF,
} from './pos-zoom';

/** IB-137 — the quadrant's view maths. The 30 rows are a real capture (slot dev-3, 2026-11-03). */
const real = (captured as unknown as WebPositioningResponse).rows;
const base = real[0];
const cell = (value: number | null) => ({ value, rarity: 0.5, unavailable: null, sample: 30 }) as WebPositioningRow['priceChangePct'];
const row = (b: string, price: number | null, oi: number | null): WebPositioningRow => ({ ...base, symbol: `${b}USDT`, base: b, priceChangePct: cell(price), oiChangePct: cell(oi) });
const sym = (h: number, v: number): Domain => ({ xMin: -h, xMax: h, yMin: -v, yMax: v });

describe('nearestRank', () => {
  it('the smallest value with at least p % at or below it; order of input does not matter; empty → 0', () => {
    const v = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6]; // 1..10
    expect([nearestRank(v, 80), nearestRank(v, 81), nearestRank(v, 100), nearestRank(v, 1)]).toEqual([8, 9, 10, 1]);
    expect(nearestRank([], 80)).toBe(0);
  });
});

describe('bulkDomain / fullDomain', () => {
  it('the real capture: «без выбросов» ±5 % price / ±5 % OI fits the bulk; «весь» is ±5 / ±20 because of one XRP at +19.5 % OI', () => {
    // P80 over 30 coins = the 24th smallest: |Δprice| 2.51 (QNT) → niceMax 5; |ΔOI| 2.31 (PUMP) → 5
    expect(bulkDomain(real)).toEqual(sym(5, 5));
    expect(fullDomain(real)).toEqual(sym(5, 20));
  });

  it('one TRUMP at +38 % / +12 % does not move the bulk, and moves «весь» out to it', () => {
    const rows = [...real, row('TRUMP2', 38, 12)];
    expect(bulkDomain(rows)).toEqual(sym(5, 5));
    expect(fullDomain(rows)).toEqual(sym(50, 20));
  });

  it('a calm market is not zoomed into noise: floors of 1 % price and 2 % OI, in both views', () => {
    const calm = Array.from({ length: 10 }, (_, i) => row(`C${i}`, 0.05 * i, -0.02 * i));
    expect(bulkDomain(calm)).toEqual(sym(BULK_FLOOR.price, BULK_FLOOR.oi));
    expect(fullDomain(calm)).toEqual(sym(BULK_FLOOR.price, BULK_FLOOR.oi));
  });

  it('symmetric around 0 (D9) whatever the sign of the bulk; coins without both changes do not count', () => {
    const rows = [...Array.from({ length: 10 }, (_, i) => row(`D${i}`, -3 - i * 0.1, -7)), row('X', null, 900), row('Y', 900, null)];
    const b = bulkDomain(rows);
    expect(b).toEqual(sym(5, 10));
    expect(b.xMin).toBe(-b.xMax);
  });

  it('«весь» is never narrower than «без выбросов»', () => {
    for (const rows of [real, [row('A', 0.1, 0.1)], [...real, row('Z', -80, 300)]]) {
      const b = bulkDomain(rows);
      const f = fullDomain(rows);
      expect(f.xMax).toBeGreaterThanOrEqual(b.xMax);
      expect(f.yMax).toBeGreaterThanOrEqual(b.yMax);
    }
  });
});

describe('zoom', () => {
  const full = sym(50, 20);

  it('the anchor stays put: zooming in about (2, 1) keeps (2, 1) at the same fraction of the view', () => {
    const d = sym(5, 5);
    const z = zoom(d, 0.5, { x: 2, y: 1 }, full);
    expect(z.xMax - z.xMin).toBeCloseTo(5);
    expect(z.yMax - z.yMin).toBeCloseTo(5);
    expect((2 - z.xMin) / (z.xMax - z.xMin)).toBeCloseTo((2 - d.xMin) / (d.xMax - d.xMin));
    expect((1 - z.yMin) / (z.yMax - z.yMin)).toBeCloseTo((1 - d.yMin) / (d.yMax - d.yMin));
  });

  it('zoom-in stops at a half-range of 0.25 % price and 0.5 % OI', () => {
    let d = sym(5, 5);
    for (let i = 0; i < 40; i++) d = zoom(d, 0.5, { x: 0, y: 0 }, full);
    expect((d.xMax - d.xMin) / 2).toBeCloseTo(ZOOM_MIN_HALF.price);
    expect((d.yMax - d.yMin) / 2).toBeCloseTo(ZOOM_MIN_HALF.oi);
  });

  it('zoom-out stops at «весь», and lands exactly on it whatever the anchor', () => {
    let d = zoom(sym(5, 5), 0.3, { x: 4, y: -4 }, full);
    for (let i = 0; i < 20; i++) d = zoom(d, 2, { x: 4.9, y: -4.9 }, full);
    expect(sameDomain(d, full)).toBe(true);
  });

  it('a zoom out near the edge is shifted back inside «весь», never past it', () => {
    const d = { xMin: 40, xMax: 50, yMin: 10, yMax: 20 };
    const z = zoom(d, 2, { x: 50, y: 20 }, full);
    expect(z.xMax).toBeLessThanOrEqual(50);
    expect(z.yMax).toBeLessThanOrEqual(20);
    expect(z.xMax - z.xMin).toBeCloseTo(20);
  });
});

describe('pan', () => {
  const full = sym(50, 20);

  it('moves by data units and clamps at «весь» without changing the width', () => {
    expect(pan(sym(5, 5), 3, -2, full)).toEqual({ xMin: -2, xMax: 8, yMin: -7, yMax: 3 });
    expect(pan(sym(5, 5), 100, 100, full)).toEqual({ xMin: 40, xMax: 50, yMin: 10, yMax: 20 });
    expect(pan(full, 5, 5, full)).toEqual(full); // nothing to pan at «весь»
  });

  it('a drag moves the content with the finger: right and down shows what was left and above', () => {
    const size = { width: 2 * QUADRANT_PAD + 100, height: 2 * QUADRANT_PAD + 100 };
    const d = panByPx(sym(5, 5), size, 10, 10, full); // 10 px of 100 = 1 % on each axis
    expect(d.xMin).toBeCloseTo(-6);
    expect(d.yMin).toBeCloseTo(-4);
  });
});

describe('pixels ↔ data, origin, axis text', () => {
  it('dataAt maps the plot corners to the domain corners', () => {
    const size = { width: 400, height: 300 };
    const d = { xMin: -2, xMax: 6, yMin: -1, yMax: 3 };
    expect(dataAt(d, size, QUADRANT_PAD, QUADRANT_PAD)).toEqual({ x: -2, y: 3 });
    expect(dataAt(d, size, 400 - QUADRANT_PAD, 300 - QUADRANT_PAD)).toEqual({ x: 6, y: -1 });
  });

  it('the origin is in view only while both zero axes are', () => {
    expect(originInView(sym(1, 1))).toBe(true);
    expect(originInView({ xMin: 0.5, xMax: 3, yMin: -1, yMax: 1 })).toBe(false);
    expect(originInView({ xMin: -3, xMax: 3, yMin: -4, yMax: -1 })).toBe(false);
  });

  it('compactPct: «+38 %», «−2.8 %», «+0.25 %», «0 %» — the page\'s minus sign', () => {
    expect([38.2, -2.81, 0.25, 0, -0.001, 12, 1.0].map(compactPct)).toEqual(['+38 %', '−2.8 %', '+0.25 %', '0 %', '0 %', '+12 %', '+1 %']);
  });
});
