import type { LiquidationMarker } from './liquidation-markers.adapter';
import { HIT_SLACK_PX, labelLeft, markerUnder, RIGHT_RESERVE_PX, tooltipLines } from './liquidation-tooltip';

const marker = (over: Partial<LiquidationMarker> = {}): LiquidationMarker => ({
  time: 0, price: 100, usd: 1_000, side: 'long', events: 1, largestUsd: 1_000,
  radius: 5, clamped: false, venues: ['bybit'], ...over,
});

describe('markerUnder', () => {
  it('finds the bubble the cursor is inside, with a little slack', () => {
    const p = { x: 100, y: 50, m: marker({ radius: 5 }) };
    expect(markerUnder([p], 103, 50)).toBe(p);
    expect(markerUnder([p], 100 + 5 + HIT_SLACK_PX, 50)).toBe(p);
    expect(markerUnder([p], 100 + 5 + HIT_SLACK_PX + 1, 50)).toBeNull();
  });

  it('where bubbles overlap, the nearest centre wins', () => {
    const big = { x: 100, y: 50, m: marker({ radius: 14 }) };
    const small = { x: 108, y: 50, m: marker({ radius: 3 }) };
    expect(markerUnder([big, small], 107, 50)).toBe(small);
    expect(markerUnder([big, small], 101, 50)).toBe(big);
  });

  it('nothing on screen, nothing under the cursor', () => {
    expect(markerUnder([], 0, 0)).toBeNull();
  });
});

describe('tooltipLines', () => {
  it('says how many liquidations and the largest, which the bubble cannot show', () => {
    const lines = tooltipLines(marker({
      usd: 4_200_000, events: 1_250, largestUsd: 1_100_000, side: 'short', venues: ['binance', 'okx'],
    }));
    expect(lines).toEqual([
      '$4.2M liquidated · mostly shorts',
      '1,250 liquidations · largest $1.1M',
      'binance, okx',
    ]);
  });

  it('one liquidation is not "largest of one"', () => {
    expect(tooltipLines(marker({ usd: 50_000, largestUsd: 50_000 }))[1]).toBe('1 liquidation');
  });

  it('a clamped bubble still states its real sum', () => {
    expect(tooltipLines(marker({ usd: 400_000_000, clamped: true, radius: 14 }))[0]).toContain('$400M');
  });
});

describe('labelLeft', () => {
  it('sits right of the bubble when there is room', () => {
    expect(labelLeft(100, 10, 200, 1_200)).toBe(110);
  });

  it('flips left before reaching the price-line tags at the right edge', () => {
    // 1 000 + 10 + 200 = 1 210 > 1 200 − reserve: it would be under PDH/PWL
    expect(labelLeft(1_000, 10, 200, 1_200)).toBe(790);
    expect(labelLeft(1_200 - RIGHT_RESERVE_PX - 210, 10, 200, 1_200)).toBe(1_200 - RIGHT_RESERVE_PX - 200);
  });

  it('never goes off the left edge', () => {
    expect(labelLeft(50, 10, 200, 240)).toBe(0);
  });
});
