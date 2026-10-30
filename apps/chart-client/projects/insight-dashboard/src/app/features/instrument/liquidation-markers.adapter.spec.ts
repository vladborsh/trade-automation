import type { WebLiquidationEvent } from '@trade-automation/contracts';
import {
  DEFAULT_SCALE_CEILING_USD, MAX_RADIUS_PX, MIN_RADIUS_PX, floorToBar, radiusFor,
  toLiquidationMarkers,
} from './liquidation-markers.adapter';

const ev = (over: Partial<WebLiquidationEvent>): WebLiquidationEvent => ({
  time: 1_000, side: 'long', usd: 1_000, price: 100, venue: 'bybit', ...over,
});

describe('floorToBar', () => {
  it('snaps an event to the start of its bar', () => {
    expect(floorToBar(1_000_123, 60)).toBe(1_000_080);
    expect(floorToBar(1_000_080, 60)).toBe(1_000_080);
  });

  it('IB-065: a weekly bubble lands on the candle\'s Monday, not on the epoch\'s Thursday', () => {
    const monday = Date.UTC(2026, 9, 26) / 1000;
    expect(floorToBar(monday + 4 * 86_400 + 77, 604_800)).toBe(monday);
  });
});

describe('radiusFor', () => {
  it('scales by AREA, so a 4x liquidation is 2x the radius above the floor', () => {
    // radius ∝ √usd: linear radius would make a 100× event look 10 000× bigger.
    const small = radiusFor(1_000_000).radius - MIN_RADIUS_PX;
    const fourX = radiusFor(4_000_000).radius - MIN_RADIUS_PX;
    expect(fourX / small).toBeCloseTo(2, 1);
  });

  it('never draws a bubble too small to see or big enough to hide the candles', () => {
    expect(radiusFor(1).radius).toBeGreaterThanOrEqual(MIN_RADIUS_PX);
    expect(radiusFor(1e12).radius).toBe(MAX_RADIUS_PX);
    expect(radiusFor(0).radius).toBe(MIN_RADIUS_PX);
  });

  it('MARKS a clamped bubble, because the clamp hides the difference', () => {
    // At the ceiling a $20M and a $200M event draw identically. The chart must not imply they
    // are alike, so the flag travels with the marker and the tooltip says the real number.
    expect(radiusFor(DEFAULT_SCALE_CEILING_USD * 2).clamped).toBe(true);
    expect(radiusFor(DEFAULT_SCALE_CEILING_USD).clamped).toBe(false);
    expect(radiusFor(5_000).clamped).toBe(false);
  });
});

describe('toLiquidationMarkers', () => {
  const opts = { barSeconds: 60 };

  it('BUCKETS A CASCADE INTO ONE BUBBLE rather than a smear of overlapping dots', () => {
    // 40 fills inside ONE bar: 999_960 is a minute boundary, so every second below 1_000_020
    // belongs to it. (The first version of this test ran 1_000_000..1_000_039 and straddled the
    // boundary, which correctly produced two markers — the fixture was wrong, not the code.)
    const events = Array.from({ length: 40 }, (_, i) => ev({ time: 999_960 + i, usd: 25_000 }));
    const markers = toLiquidationMarkers(events, opts);
    expect(markers).toHaveLength(1);
    expect(markers[0].time).toBe(999_960);
    expect(markers[0].events).toBe(40);
    expect(markers[0].usd).toBe(1_000_000);
  });

  it('keeps separate bars separate', () => {
    const markers = toLiquidationMarkers([ev({ time: 1_000_000 }), ev({ time: 1_000_100 })], opts);
    expect(markers.map((m) => m.time)).toEqual([999_960, 1_000_080]);
  });

  it('returns markers in time order whatever order the events arrive in', () => {
    // the endpoint sorts by SIZE to pick what fits the cap, so unsorted input is the normal case
    const markers = toLiquidationMarkers(
      [ev({ time: 1_000_300 }), ev({ time: 1_000_000 }), ev({ time: 1_000_150 })],
      opts,
    );
    expect(markers.map((m) => m.time)).toEqual([...markers.map((m) => m.time)].sort((a, b) => a - b));
  });

  it('prices a bucket by VOLUME WEIGHT, not by whichever event came last', () => {
    // $10k at 100 and $1M at 95 happened at ~95 for any purpose a reader has.
    const [marker] = toLiquidationMarkers(
      [ev({ time: 1_000_000, usd: 10_000, price: 100 }), ev({ time: 1_000_001, usd: 1_000_000, price: 95 })],
      opts,
    );
    expect(marker.price).toBeCloseTo(95.05, 1);
  });

  it('gives the bubble the side holding more money, not the side with more events', () => {
    // One large long against many small shorts is a long squeeze; counting events would call it
    // the opposite and colour it the wrong way.
    const [marker] = toLiquidationMarkers([
      ev({ time: 1_000_000, side: 'long', usd: 900_000 }),
      ev({ time: 1_000_001, side: 'short', usd: 1_000 }),
      ev({ time: 1_000_002, side: 'short', usd: 1_000 }),
      ev({ time: 1_000_003, side: 'short', usd: 1_000 }),
    ], opts);
    expect(marker.side).toBe('long');
    expect(marker.events).toBe(4);
  });

  it('names every venue in the bucket, so a bubble cannot imply one exchange', () => {
    const [marker] = toLiquidationMarkers([
      ev({ time: 1_000_000, venue: 'okx' }),
      ev({ time: 1_000_001, venue: 'bybit' }),
      ev({ time: 1_000_002, venue: 'okx' }),
    ], opts);
    expect(marker.venues).toEqual(['bybit', 'okx']);
  });

  it('buckets to the chart\'s frame, so the same events regroup when the timeframe changes', () => {
    const events = [ev({ time: 1_000_000 }), ev({ time: 1_000_400 })];
    expect(toLiquidationMarkers(events, { barSeconds: 60 })).toHaveLength(2);
    expect(toLiquidationMarkers(events, { barSeconds: 900 })).toHaveLength(1);
  });

  it('is empty for no events rather than inventing a zero bubble', () => {
    expect(toLiquidationMarkers([], opts)).toEqual([]);
  });
});

describe('IB-068: rows the server already grouped per bar', () => {
  const opts = { barSeconds: 3_600 };
  const bar = 3_600 * 500_000;

  it('sums COUNT, not rows: three grouped rows can stand for 180 liquidations', () => {
    const markers = toLiquidationMarkers([
      ev({ time: bar, side: 'long', venue: 'binance', usd: 100_000, count: 120, maxUsd: 9_000 }),
      ev({ time: bar, side: 'short', venue: 'binance', usd: 20_000, count: 50, maxUsd: 4_000 }),
      ev({ time: bar, side: 'long', venue: 'okx', usd: 30_000, count: 10, maxUsd: 25_000 }),
    ], opts);
    expect(markers).toHaveLength(1);
    expect(markers[0].events).toBe(180);
    expect(markers[0].usd).toBe(150_000);
    expect(markers[0].venues).toEqual(['binance', 'okx']);
  });

  it('keeps the largest single liquidation across the rows, not the largest row', () => {
    const markers = toLiquidationMarkers([
      ev({ time: bar, usd: 100_000, count: 120, maxUsd: 9_000 }),
      ev({ time: bar, venue: 'okx', usd: 30_000, count: 10, maxUsd: 25_000 }),
    ], opts);
    expect(markers[0].largestUsd).toBe(25_000);
  });

  it('the VWAP of grouped VWAPs, weighted by their USD, is the whole bar\'s VWAP', () => {
    // binance: $1 000 @ 100 and $3 000 @ 110 → $4 000 @ 107.5; okx: $4 000 @ 102.5
    const markers = toLiquidationMarkers([
      ev({ time: bar, usd: 4_000, price: 107.5, count: 2, maxUsd: 3_000 }),
      ev({ time: bar, venue: 'okx', usd: 4_000, price: 102.5, count: 1, maxUsd: 4_000 }),
    ], opts);
    expect(markers[0].price).toBeCloseTo((1_000 * 100 + 3_000 * 110 + 4_000 * 102.5) / 8_000, 10);
  });

  it('a raw event still counts one and is its own largest, so a live tail mixes in unchanged', () => {
    const markers = toLiquidationMarkers([
      ev({ time: bar, usd: 50_000, count: 7, maxUsd: 20_000 }),
      ev({ time: bar + 60, usd: 30_000 }),
    ], opts);
    expect(markers[0].events).toBe(8);
    expect(markers[0].largestUsd).toBe(30_000);
  });
});
