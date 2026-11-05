import type { WebPositioningResponse, WebPositioningRow } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../../../libs/contracts/test/fixtures/positioning.24h.json';
import { en } from '../../i18n/en';
import { ru } from '../../i18n/ru';
import { type Box, DOT_R_MAX, DOT_R_MIN, heatOf, heatRow, LABEL_CHAR_PX, niceMax, PIN_R, quadrantLayout, quadrantLink } from './pos-layout';

/** IB-090 — positioning geometry and cell words, on the contract fixture (BTC, ETH, SOL, DOGE). */
const rows = (fixture as unknown as WebPositioningResponse).rows;
const size = { width: 342, height: 260 };
const cell = (value: number | null, rarity: number | null = null) => ({ value, rarity, unavailable: value === null || rarity === null ? 'insufficient_history' : null, sample: 0 }) as WebPositioningRow['priceChangePct'];
const row = (base: string, price: number | null, oi: number | null, oiUsd: number | null = 1e9): WebPositioningRow => ({
  ...rows[0], symbol: `${base}USDT`, base, priceChangePct: cell(price, 0.5), oiChangePct: cell(oi, 0.5), oiUsd,
});

describe('quadrantLayout', () => {
  it('price across, OI up, axes crossing at the centre: each fixture coin lands in its own quadrant', () => {
    const l = quadrantLayout(rows, size);
    const at = (b: string) => l.dots.find((d) => d.row.base === b)!;
    expect([l.x0, l.y0]).toEqual([171, 130]);
    // BTC: price −1.2, OI +3.4 → left, up (new shorts); ETH −4.8/−6.1 → left, down; SOL +0.1/+26 → right of centre, top
    expect(at('BTC').cx).toBeLessThan(l.x0); expect(at('BTC').cy).toBeLessThan(l.y0);
    expect(at('ETH').cx).toBeLessThan(l.x0); expect(at('ETH').cy).toBeGreaterThan(l.y0);
    expect(at('SOL').cx).toBeGreaterThan(l.x0); expect(at('SOL').cy).toBeLessThan(l.y0);
  });

  it('symmetric, round axis ends: ±5 % price, ±50 % OI for the fixture', () => {
    const l = quadrantLayout(rows, size);
    expect([l.domain.xMax, l.domain.yMax]).toEqual([5, 50]);
    expect([l.domain.xMin, l.domain.yMin]).toEqual([-5, -50]);
    expect([niceMax(0), niceMax(1.2), niceMax(3.4), niceMax(26), niceMax(101)]).toEqual([1, 2, 5, 50, 200]);
  });

  it('dot area ∝ OI in USD: the biggest is DOT_R_MAX, a quarter of the OI is half the radius; no OI → the smallest dot', () => {
    const l = quadrantLayout([row('A', 1, 1, 4e9), row('B', -1, 1, 1e9), row('C', 1, -1, null)], size);
    const r = Object.fromEntries(l.dots.map((d) => [d.row.base, d.r]));
    expect(r).toEqual({ A: DOT_R_MAX, B: DOT_R_MAX / 2, C: DOT_R_MIN });
  });

  it('a coin without both changes is counted, not placed at the origin', () => {
    const l = quadrantLayout([...rows, row('X', null, 3)], size);
    expect(l.unplaced).toBe(1);
    expect(l.dots.map((d) => d.row.base)).not.toContain('X');
  });

  it('labels never overlap each other or a dot, and stay inside the box — even for a crowded centre', () => {
    const crowd = Array.from({ length: 20 }, (_, i) => row(`C${i}`, (i % 5) * 0.05, Math.floor(i / 5) * 0.05, 1e9 - i));
    const l = quadrantLayout(crowd, size);
    const boxes = l.dots.filter((d) => d.label).map((d) => d.label!.box);
    for (const d of l.dots.filter((x) => x.label)) expect(d.label!.box.w).toBeCloseTo(d.row.base.length * LABEL_CHAR_PX);
    const dotBoxes = l.dots.map((d) => ({ x: d.cx - d.r, y: d.cy - d.r, w: 2 * d.r, h: 2 * d.r }));
    const hit = (a: Box, b: Box) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(hit(boxes[i], boxes[j])).toBe(false);
      for (const d of dotBoxes) expect(hit(boxes[i], d)).toBe(false);
      expect(boxes[i].x).toBeGreaterThanOrEqual(0);
      expect(boxes[i].x + boxes[i].w).toBeLessThanOrEqual(size.width);
    }
    expect(boxes.length + l.hiddenLabels).toBe(20);
    expect(l.hiddenLabels).toBeGreaterThan(0); // the crowd really did collide — the test exercised the drop
  });
});

describe('quadrantLayout with a view (IB-137)', () => {
  const big = { width: 600, height: 400 };
  const bulk = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
  const crowd = [row('A', 1, 1, 4e9), row('B', -2, 3, 3e9), row('C', 2, -2, 2e9), row('D', -1, -1, 1e9)];

  it('a coin beyond the view is drawn ON THE EDGE at its clamped position, sign kept, as an arrow with its true values', () => {
    const l = quadrantLayout([...crowd, row('TRUMP', 38, 12, 5e8)], big, bulk);
    const t = l.dots.find((d) => d.row.base === 'TRUMP')!;
    expect([t.cx, t.cy]).toEqual([l.right, l.top]); // top-right corner: price up, OI up
    expect(t.pin).toEqual({ dx: 1, dy: 1, angle: -45 });
    expect(t.r).toBe(PIN_R);
    expect(t.label?.text).toBe('TRUMP +38 % / +12 %');
    expect(l.pinned).toBe(1);
    // the label sits INSIDE the chart (inward of the right edge)
    expect(t.label!.box.x + t.label!.box.w).toBeLessThanOrEqual(big.width);
  });

  it('pinned on one axis only: the other stays where it is; each direction gets its arrow', () => {
    const l = quadrantLayout([...crowd, row('L', -40, 2, 1e8), row('Dn', 1, -30, 1e8)], big, bulk);
    const at = (b: string) => l.dots.find((d) => d.row.base === b)!;
    expect(at('L').pin).toEqual({ dx: -1, dy: 0, angle: 180 });
    expect(at('L').cx).toBe(l.left);
    expect(at('L').cy).toBeCloseTo(l.top + ((5 - 2) / 10) * (l.bottom - l.top));
    expect(at('Dn').pin).toMatchObject({ dx: 0, dy: -1, angle: 90 });
    expect(at('Dn').cy).toBe(l.bottom);
    expect(at('A').pin).toBeNull();
  });

  it('pinned labels win collisions: an in-box coin whose label wants the same spot yields it', () => {
    // OUT is pinned to the right edge at OI 0; its only spot inside the chart is to its LEFT, which
    // is exactly where Q's (bigger, so first by OI) label would go. Placed by OI alone, OUT would lose.
    const q = row('Q', -5 + ((430 - 28) / 544) * 10, 0, 1e9);
    const l = quadrantLayout([q, row('OUT', 30, 0, 1)], big, bulk);
    const at = (b: string) => l.dots.find((d) => d.row.base === b)!;
    expect(at('OUT').label?.anchor).toBe('end');
    expect(at('Q').label?.anchor).toBe('end'); // Q moved its label to its own left
  });

  it('on a phone, the farthest-out coin\'s label wins: a bigger coin just past the top edge does not take the corner from TRUMP', () => {
    // 342 px: NEAR (+0.4 / +5.4, OI 5e9) is just above the bulk view, TRUMP (+38 / +12) far out in the corner.
    // By OI alone NEAR's long label would claim the top-left run first and TRUMP's would find no spot.
    const view = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
    const l = quadrantLayout([row('NEAR', 0.4, 5.4, 5e9), row('TRUMP', 38, 12, 1e8)], size, view);
    const t = l.dots.find((d) => d.row.base === 'TRUMP')!;
    expect(t.label?.text).toBe('TRUMP +38 % / +12 %');
    expect(t.label!.box.x + t.label!.box.w).toBeLessThanOrEqual(size.width);
    expect(t.label!.box.x).toBeGreaterThanOrEqual(0);
  });

  it('the dots stay in OI order whatever the label order (the keyboard walks them in that order)', () => {
    const l = quadrantLayout([...crowd, row('TRUMP', 38, 12, 5e8)], big, bulk);
    expect(l.dots.map((d) => d.row.base)).toEqual(['A', 'B', 'C', 'D', 'TRUMP']);
  });

  it('zero outside the view: its axis is clamped to the edge and flagged out; the origin is not in view', () => {
    const l = quadrantLayout(crowd, big, { xMin: 0.5, xMax: 2.5, yMin: -3, yMax: 3 });
    expect([l.x0In, l.y0In, l.originIn]).toEqual([false, true, false]);
    expect(l.x0).toBe(l.left);
    const all = quadrantLayout(crowd, big, bulk);
    expect([all.x0In, all.y0In, all.originIn]).toEqual([true, true, true]);
    expect([all.x0, all.y0]).toEqual([300, 200]);
  });

  it('dots keep their size when the view changes (a data domain, not a CSS scale)', () => {
    const a = quadrantLayout(crowd, big, bulk);
    const b = quadrantLayout(crowd, big, { xMin: -2.5, xMax: 2.5, yMin: -3.5, yMax: 3.5 });
    expect(b.dots.map((d) => d.r)).toEqual(a.dots.map((d) => d.r));
  });
});

describe('quadrantLink (IB-137 = R4\'s link, IB-BUG-023)', () => {
  it('/instrument/<SYM> at the start of the period the dot measures, marked as a period start', () => {
    expect(quadrantLink('TRUMPUSDT', 1_800_000_000, '24h')).toEqual({ commands: ['/instrument', 'TRUMPUSDT'], queryParams: { at: 1_800_000_000 - 86_400, span: '24h' } });
    expect(quadrantLink('BTCUSDT', 1_800_000_000, '4h').queryParams.at).toBe(1_800_000_000 - 14_400);
  });
});

describe('heat — by rarity, not by sign', () => {
  it('a rare fall and a rare rise look the same; null is NONE, not typical', () => {
    expect([heatOf(0.995), heatOf(0.93), heatOf(0.8), heatOf(0.5), heatOf(0.1), heatOf(null)]).toEqual(['extreme', 'unusual', 'notable', 'typical', 'typical', 'none']);
    const eth = heatRow(rows.find((r) => r.base === 'ETH')!);
    expect(eth.cells.priceChangePct).toEqual({ text: '−4.80 %', heat: 'unusual', reasonKey: null }); // a fall
    expect(heatRow(rows.find((r) => r.base === 'SOL')!).cells.oiChangePct.heat).toBe('extreme'); // a rise
  });

  it('cells in their own units; an absent rarity carries its reason, translated', () => {
    const btc = heatRow(rows.find((r) => r.base === 'BTC')!);
    expect(btc.cells.fundingRate.text).toBe('0.0120 %');
    expect(btc.cells.lsGlobal.text).toBe('1.84');
    expect(btc.cells.liqUsd).toEqual({ text: '$3.4M', heat: 'none', reasonKey: 'positioning.unavailable.insufficient_history' });
    for (const t of [ru, en]) for (const k of ['positioning.unavailable.insufficient_history', 'positioning.unavailable.venue_unavailable', 'positioning.unavailable.not_listed']) expect((t as Record<string, string>)[k], k).toBeTruthy();
  });

  it('every signal word is translated (the enum is closed)', () => {
    expect(heatRow(rows.find((r) => r.base === 'SOL')!).signalKey).toBe('positioning.signal.crowded_long');
    for (const s of ['squeeze', 'capitulation', 'crowded_long', 'crowded_short', 'quiet']) for (const t of [ru, en]) expect((t as Record<string, string>)[`positioning.signal.${s}`], s).toBeTruthy();
  });
});
