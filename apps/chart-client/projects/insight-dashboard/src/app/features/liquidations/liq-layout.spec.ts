import type { WebLiquidationBlock, WebLiquidationHourly, WebLiquidationLargeEvent } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import blockFixture from '../../../../../../../../libs/contracts/test/fixtures/liquidation-block.24h.json';
import { en } from '../../i18n/en';
import { ru } from '../../i18n/ru';
import {
  BUBBLE_EDGE_PAD,
  BUBBLE_R_MAX,
  BUBBLE_R_MIN,
  type BubbleTick,
  blockView,
  bubbleLayout,
  HOURLY_PAD_BOTTOM,
  HOURLY_PAD_TOP,
  hourlyLayout,
  largeCards,
  normNote,
  TICK_AIR_PX,
  TICK_CHAR_PX,
  tickLabel,
  whereRows,
} from './liq-layout';

/** IB-089 — the liquidation charts' geometry and words, on the contract fixture (a 30-day norm). */
const block = blockFixture as unknown as WebLiquidationBlock;
const size = { width: 480, height: 200 };

const hourly = (buckets: Array<[number, number, boolean?]>, norm: { long: number | null; short: number | null; total: number | null }): WebLiquidationHourly => ({
  bucketSec: 3600,
  buckets: buckets.map(([long, short, outlier = false], i) => ({ time: 1_793_700_000 + i * 3600, long, short, partial: false, rarity: null, outlier })),
  norm,
  basis: block.hourly.basis,
});

describe('hourlyLayout — mirrored bars', () => {
  it('shorts go UP from the axis, longs DOWN, on one scale', () => {
    const l = hourlyLayout(hourly([[100, 50], [0, 200]], { long: null, short: null, total: null }), size);
    const half = (size.height - HOURLY_PAD_TOP - HOURLY_PAD_BOTTOM) / 2;
    expect(l.axisY).toBe(HOURLY_PAD_TOP + half);
    // the biggest value (200 short) fills the half exactly; 100 long is half of it
    expect(l.bars[1].shortH).toBeCloseTo(half);
    expect(l.bars[1].shortY).toBeCloseTo(l.axisY - half);
    expect(l.bars[0].longH).toBeCloseTo(half / 2);
    expect(l.bars[0].longY).toBe(l.axisY);
    expect(l.bars.every((b) => b.x >= 0 && b.x + b.w <= size.width)).toBe(true);
  });

  it('the norm is a line per side, inside the plot even when it is bigger than every bar', () => {
    const l = hourlyLayout(hourly([[10, 10]], { long: 40, short: 20, total: 60 }), size);
    expect(l.norm.longY).toBeCloseTo(size.height - HOURLY_PAD_BOTTOM);
    expect(l.norm.shortY).toBeGreaterThan(HOURLY_PAD_TOP);
  });

  it('an outlier bucket gets a «× norm» callout; a side without a norm draws no line', () => {
    const l = hourlyLayout(hourly([[3_600_000, 600_000, true], [100, 100]], { long: null, short: 550_000, total: 1_500_000 }), size);
    expect(l.callouts).toEqual([{ x: l.bars[0].x + l.bars[0].w / 2, text: '×2.8' }]);
    expect(l.norm.longY).toBeNull();
  });

  it('the fixture: 24 bars, one outlier, its callout is total ÷ norm total', () => {
    const l = hourlyLayout(block.hourly, size);
    const out = block.hourly.buckets.find((b) => b.outlier)!;
    expect(l.bars).toHaveLength(24);
    expect(l.callouts).toHaveLength(1);
    expect(l.callouts[0].text).toBe(`×${((out.long + out.short) / (block.hourly.norm.total as number)).toFixed(1)}`);
  });

  it('a window with nothing in it says empty instead of drawing a flat axis', () => {
    expect(hourlyLayout(hourly([[0, 0], [0, 0]], { long: null, short: null, total: null }), size).empty).toBe(true);
  });

  it('time labels never crowd: at 390 px, 24 hourly buckets get at most one label per 52 px, the last bar labelled', () => {
    const l = hourlyLayout(block.hourly, { width: 358, height: 160 });
    for (let i = 1; i < l.ticks.length; i++) expect(l.ticks[i].x - l.ticks[i - 1].x).toBeGreaterThanOrEqual(52);
    expect(l.ticks.at(-1)?.time).toBe(block.hourly.buckets.at(-1)?.time);
  });

  it('labels: HH:MM for hourly buckets, DD/MM HH:MM for the 7d chart', () => {
    expect(tickLabel(1_793_721_600, 3600, 'UTC')).toBe('16:00');
    expect(tickLabel(1_793_721_600, 14_400, 'UTC')).toBe('03/11 16:00');
  });
});

describe('whereRows — diverging bars', () => {
  it('biggest coin first, one scale for both sides, the verdict worded with its ratio', () => {
    const { rows } = whereRows(block.perCoin);
    expect(rows.map((r) => r.base)).toEqual([...block.perCoin].sort((a, b) => b.totals.usd - a.totals.usd).map((c) => c.base));
    expect(Math.max(...rows.flatMap((r) => [r.longPct, r.shortPct]))).toBe(100);
    expect(rows.find((r) => r.base === 'BTC')?.verdict).toEqual({ key: 'liq.verdict.long', params: { ratio: '×2.4' } });
    expect(rows.find((r) => r.base === 'ETH')?.verdict).toBeNull();
  });

  it('a coin with nothing in the period is counted, not drawn', () => {
    const quietCoin = { ...block.perCoin[0], symbol: 'XUSDT', base: 'X', totals: { usd: 0, long: 0, short: 0, events: 0 } };
    const r = whereRows([...block.perCoin, quietCoin]);
    expect(r.quiet).toBe(1);
    expect(r.rows.map((x) => x.base)).not.toContain('X');
  });
});

describe('bubbleLayout — large liquidations over the period', () => {
  const ev = (time: number, usd: number, side: 'long' | 'short'): WebLiquidationLargeEvent => ({
    time, usd, side, symbol: 'BTCUSDT', base: 'BTC', price: 1, venue: 'binance', xMedian: null, seriesId: null, seriesCount: 0, seriesSpanSec: 0,
  });
  const win = { from: 0, to: 86_400 };

  it('radius ∝ √USD (area ∝ money), shorts above the axis, longs below', () => {
    const { axisY, bubbles } = bubbleLayout([ev(1000, 4_000_000, 'short'), ev(50_000, 1_000_000, 'long')], win, size);
    const big = bubbles.find((b) => b.event.usd === 4_000_000)!;
    const small = bubbles.find((b) => b.event.usd === 1_000_000)!;
    expect(big.r).toBe(BUBBLE_R_MAX);
    expect(small.r).toBeCloseTo(BUBBLE_R_MAX / 2);
    expect(big.cy).toBeLessThan(axisY);
    expect(small.cy).toBeGreaterThan(axisY);
    expect(small.cx).toBeGreaterThan(big.cx);
  });

  it('a cascade at one minute stacks outward instead of hiding behind the biggest bubble', () => {
    const { bubbles } = bubbleLayout([ev(1000, 2e6, 'long'), ev(1010, 2e6, 'long'), ev(1020, 2e6, 'long')], win, { width: 480, height: 300 });
    const ys = bubbles.map((b) => b.cy).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(2 * BUBBLE_R_MAX - 0.01);
  });

  it('a tiny event is still visible, and everything stays inside the box', () => {
    const { bubbles } = bubbleLayout([ev(0, 1e7, 'short'), ev(86_400, 1, 'long')], win, { width: 358, height: 140 });
    expect(Math.min(...bubbles.map((b) => b.r))).toBe(BUBBLE_R_MIN);
    for (const b of bubbles) {
      expect(b.cx - b.r).toBeGreaterThanOrEqual(0);
      expect(b.cx + b.r).toBeLessThanOrEqual(358);
      expect(b.cy - b.r).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('bubbleLayout — nothing cut at the edges (IB-BUG-036)', () => {
  const ev = (time: number, usd: number, side: 'long' | 'short'): WebLiquidationLargeEvent => ({
    time, usd, side, symbol: 'BTCUSDT', base: 'BTC', price: 1, venue: 'binance', xMedian: null, seriesId: null, seriesCount: 0, seriesSpanSec: 0,
  });
  const STROKE_HALF = 0.5;
  const asOf = Date.UTC(2026, 10, 5, 13, 33) / 1000; // the IB-118 shot: 05/11 13:33 UTC
  const week = { from: asOf - 7 * 86_400, to: asOf };
  const day = { from: asOf - 86_400, to: asOf };
  const plus3 = { days: true, offset: () => 3 * 3600 };
  const half = (t: BubbleTick) => (t.label.length * TICK_CHAR_PX) / 2;
  const expectFitted = (ticks: BubbleTick[], width: number) => {
    for (const t of ticks) {
      expect(t.x - half(t)).toBeGreaterThanOrEqual(0);
      expect(t.x + half(t)).toBeLessThanOrEqual(width);
    }
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].x - half(ticks[i]) - (ticks[i - 1].x + half(ticks[i - 1]))).toBeGreaterThanOrEqual(TICK_AIR_PX);
    }
  };

  it('a column taller than its side squeezes, but the outermost bubble and its stroke stay inside — both sides, 390 px', () => {
    const height = 140;
    const column = [0, 1, 2, 3, 4].flatMap((i) => [ev(day.to - 600 + i, 4e6 - i, 'short'), ev(day.to - 600 + i, 4e6 - i, 'long')]);
    const { bubbles } = bubbleLayout(column, day, { width: 324, height });
    for (const b of bubbles) {
      expect(b.cy - b.r - STROKE_HALF).toBeGreaterThanOrEqual(0);
      expect(b.cy + b.r + STROKE_HALF).toBeLessThanOrEqual(height - HOURLY_PAD_BOTTOM);
    }
    expect(Math.min(...bubbles.map((b) => b.cy - b.r))).toBeCloseTo(BUBBLE_EDGE_PAD); // squeezed to the edge, not left far below it
  });

  // The chart's width as measured live on 2026-11-05: 1158 px at a 1240 viewport, 324 px at 390.
  it('7d at 1240: one DD/MM label per local midnight, no time', () => {
    for (const width of [1158]) {
      const { ticks } = bubbleLayout([], week, { width, height: 140 }, plus3);
      expect(ticks.map((t) => t.label)).toEqual(['30/10', '31/10', '01/11', '02/11', '03/11', '04/11', '05/11']);
      for (const t of ticks) expect((t.time + 3 * 3600) % 86_400).toBe(0); // the member's midnight, not UTC's
      expectFitted(ticks, width);
    }
  });

  it('7d on the member\'s clock: the same window in UTC puts each day label 3 h later', () => {
    const local = bubbleLayout([], week, { width: 1158, height: 140 }, plus3).ticks;
    const utc = bubbleLayout([], week, { width: 1158, height: 140 }, { days: true, offset: () => 0 }).ticks;
    expect(utc.map((t) => t.time - 3 * 3600)).toEqual(local.map((t) => t.time));
  });

  it('7d at 390 (a 324 px chart, too narrow for a label a day): every other day, today kept, no overlap', () => {
    const { ticks } = bubbleLayout([], week, { width: 324, height: 140 }, plus3);
    expect(ticks.map((t) => t.label)).toEqual(['30/10', '01/11', '03/11', '05/11']);
    expectFitted(ticks, 324);
  });

  it('24h: HH:MM labels, the first and last whole, at 1240 and 390', () => {
    for (const width of [1158, 324]) {
      const { ticks } = bubbleLayout([], day, { width, height: 140 }, { days: false, offset: () => 0 });
      expect(ticks.length).toBeGreaterThan(2);
      for (const t of ticks) expect(t.label).toMatch(/^\d\d:\d\d$/);
      expect(ticks.at(-1)!.label).toBe('13:33');
      expectFitted(ticks, width);
    }
  });
});

describe('largeCards', () => {
  it('biggest first; × median and the series worded; the link is IB-088 format', () => {
    const cards = largeCards(block.large);
    expect(cards.map((c) => c.event.usd)).toEqual([2_400_000, 900_000, 310_000]);
    expect(cards[0].xMedian).toEqual({ key: 'liq.large.xMedian', params: { x: '×180' } });
    expect(cards[0].series).toEqual({ key: 'liq.large.series', params: { count: 4, minutes: Math.max(1, Math.round(block.large[0].seriesSpanSec / 60)) } });
    expect(cards[2].series).toBeNull();
    expect(cards[0].link).toEqual({ commands: ['/instrument', 'BTCUSDT'], queryParams: { at: block.large.find((e) => e.usd === 2_400_000)!.time } });
  });

  it('IB-BUG-033: each card names its venue as the venue spells it, never our key', () => {
    const names = { binance: 'Binance', bybit: 'Bybit', okx: 'OKX' } as Record<string, string>;
    for (const c of largeCards(block.large)) expect(c.venue).toBe(names[c.event.venue]);
  });
});

describe('normNote — no empty space where a norm would be', () => {
  const basis = block.hourly.basis;
  it('says what the norm is when there is one', () => {
    expect(normNote(basis, '24h', null, 0)).toEqual({ key: 'liq.norm.median', params: { days: 30, observed: 690, total: 720 } });
  });
  it('the first week: the day it will appear (= when 7 days of tape exist)', () => {
    const young = { ...basis, unavailable: 'insufficient_history' as const };
    expect(normNote(young, '24h', 1_794_269_312, 1_793_700_000)).toEqual({ key: 'liq.norm.from', params: { date: '2026-11-10' } });
    expect(normNote(young, '24h', null, 1_793_700_000).key).toBe('liq.norm.noHistory');
  });
  it('7d always refuses, with its own reason', () => {
    expect(normNote(basis, '7d', null, 0).key).toBe('liq.norm.week');
  });
  it('no_norm keeps its counts', () => {
    expect(normNote({ ...basis, unavailable: 'no_norm' }, '1h', null, 0)).toEqual({ key: 'liq.norm.noNorm', params: { observed: 690, total: 720 } });
  });
  it('every note and verdict key is translated in both languages', () => {
    const keys = ['liq.norm.median', 'liq.norm.from', 'liq.norm.noHistory', 'liq.norm.week', 'liq.norm.noNorm', 'liq.verdict.long', 'liq.verdict.short', 'liq.large.xMedian', 'liq.large.series'];
    for (const t of [ru, en]) for (const k of keys) expect((t as Record<string, string>)[k], k).toBeTruthy();
  });
});

describe('blockView — the facts around the charts', () => {
  const overview = (over: Partial<WebLiquidationBlock> = {}, missing: string[] = []) => ({
    asOf: 1_793_721_600, windows: [], perCoin: [], feed: [], feedMinUsd: 0, unmappedRows: 0,
    venues: { present: ['binance'], missing }, block: { ...block, ...over },
  }) as never;

  it('totals, the period window ending at asOf, TradFi said outside the totals', () => {
    const v = blockView(overview(), '24h', 1_793_721_600);
    expect(v.window).toEqual({ from: 1_793_721_600 - 86_400, to: 1_793_721_600 });
    expect(v.tradfi).toEqual({ key: 'liq.tradfi', params: { usd: '$3.2M' } });
    expect(v.unknown).toEqual({ key: 'liq.unknown', params: { usd: '$12K', events: 2 } });
    expect(v.venues).toBeNull();
    expect(v.present).toEqual({ key: 'liq.venues.present', params: { venues: 'Binance' } });
    expect(v.largeNote).toBeNull(); // every fixture card has its «× медианы»
    expect(v.hourlyNote.key).toBe('liq.norm.median');
  });

  it('a venue that wrote nothing is named; nothing outside the totals means no line', () => {
    const zero = { usd: 0, long: 0, short: 0, events: 0 };
    const v = blockView(overview({ unknown: zero, tradfi: zero }, ['okx']), '1h', 0);
    expect(v.venues?.params).toEqual({ venues: 'OKX' });
    expect([v.tradfi, v.unknown]).toEqual([null, null]);
  });

  it('cards without «× медианы» get the reason once, under them', () => {
    const young = { ...block.hourly.basis, unavailable: 'insufficient_history' as const };
    const v = blockView(overview({
      large: block.large.map((e) => ({ ...e, xMedian: null })),
      hourly: { ...block.hourly, basis: young },
      availableFrom: { '1h': null, '4h': null, '24h': null, '7d': 1_794_269_312 },
    }), '24h', 1_793_700_000);
    expect(v.largeNote).toEqual({ key: 'liq.norm.from', params: { date: '2026-11-10' } });
  });
});
