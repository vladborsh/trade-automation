import type { BinanceRestKline } from '@trade-automation/binance-client';
import {
  barsFromKlines, closeAtOrBefore, closedBars, klinesRequest, klinesWeight, windowCoverage, type ReactionBar,
} from '../../src/news/reaction-prices';
import { reactionWindow } from '../../src/news/reaction';

/**
 * IB-097 — the price rules over fetched klines, with the semantics of the SQL reads they replaced
 * (`closeAtOrBefore` / `windowCoverage` on `candles_1m`). The cases from the old
 * test/db/reaction-reads.integration.spec.ts are carried over here, plus the ones only a REST answer
 * can produce: bars past `to`, and the bar still forming.
 */

const DAY = Date.UTC(2026, 5, 1);
const MIN = 60_000;

/** A Binance 1m kline tuple, close = `close`, closing one millisecond before the next minute. */
const kline = (openTime: number, close: number): BinanceRestKline =>
  [openTime, String(close), String(close), String(close), String(close), '1', openTime + MIN - 1, '1', 1, '0.5', '0.5', '0'];
const bar = (i: number, close = 100 + i): ReactionBar => ({ openTime: DAY + i * MIN, closeTime: DAY + (i + 1) * MIN - 1, close });
const hour = Array.from({ length: 60 }, (_, i) => bar(i));

describe('closeAtOrBefore — the last bar opened at or before the instant', () => {
  it('takes the bar at or BEFORE the anchor, never the one after (anchor 30 s into minute 12)', () => {
    expect(closeAtOrBefore(hour, new Date(DAY + 12 * MIN + 30_000))).toBe(112);
  });

  it('a bar exactly ON the instant is that instant\'s bar, not the minute before', () => {
    expect(closeAtOrBefore(hour, new Date(DAY + 12 * MIN))).toBe(112);
    expect(closeAtOrBefore(hour, new Date(DAY + 12 * MIN - 1))).toBe(111);
  });

  it('is null before the series begins', () => {
    expect(closeAtOrBefore(hour, new Date(DAY - MIN))).toBeNull();
  });

  it('ignores bars after the instant even when the venue returned them (priceAtHorizon is never past `to`)', () => {
    const withExtra = [...hour, bar(60, 999), bar(61, 999)];
    expect(closeAtOrBefore(withExtra, new Date(DAY + 59 * MIN))).toBe(159);
  });

  it('does not depend on the order the bars arrived in', () => {
    expect(closeAtOrBefore([...hour].reverse(), new Date(DAY + 12 * MIN + 30_000))).toBe(112);
  });
});

describe('windowCoverage — one bar per minute of [from, to)', () => {
  it('finds a whole window whole — the positive control', () => {
    expect(windowCoverage(hour, new Date(DAY), new Date(DAY + 60 * MIN))).toEqual({ present: 60, expected: 60, covered: true });
  });

  it('a one-minute hole is not covered', () => {
    const holed = hour.filter((b) => b.openTime !== DAY + 30 * MIN);
    expect(windowCoverage(holed, new Date(DAY), new Date(DAY + 60 * MIN))).toEqual({ present: 59, expected: 60, covered: false });
  });

  it('counts only [from, to): bars outside the window cannot fill a hole inside it', () => {
    const holed = [...hour.filter((b) => b.openTime !== DAY + 30 * MIN), bar(60), bar(61)];
    expect(windowCoverage(holed, new Date(DAY), new Date(DAY + 60 * MIN)).covered).toBe(false);
  });

  it('a duplicated bar does not count twice', () => {
    const dup = [...hour.filter((b) => b.openTime !== DAY + 30 * MIN), bar(29)];
    expect(windowCoverage(dup, new Date(DAY), new Date(DAY + 60 * MIN)).present).toBe(59);
  });

  it('refuses a zero-width window rather than calling it covered', () => {
    expect(windowCoverage(hour, new Date(DAY), new Date(DAY)).covered).toBe(false);
  });

  it('a mid-minute anchor: the window\'s bars start at the next minute, as the SQL counted them', () => {
    const from = new Date(DAY + 10 * MIN + 30_000);
    expect(windowCoverage(hour, from, new Date(from.getTime() + 15 * MIN))).toEqual({ present: 15, expected: 15, covered: true });
  });
});

describe('closedBars — the forming bar is not a price', () => {
  it('drops a bar whose close time has not passed', () => {
    const now = DAY + 59 * MIN + 20_000; // 20 s into minute 59
    expect(closedBars(hour, now).map((b) => b.openTime)).toEqual(hour.slice(0, 59).map((b) => b.openTime));
  });

  it('keeps it once it has closed', () => {
    expect(closedBars(hour, DAY + 60 * MIN)).toHaveLength(60);
  });
});

describe('barsFromKlines', () => {
  it('reads open time, close time and close from the venue tuple', () => {
    expect(barsFromKlines([kline(DAY, 101.5)])).toEqual([{ openTime: DAY, closeTime: DAY + MIN - 1, close: 101.5 }]);
  });

  it('drops a row with an unreadable or zero close rather than reading it as 0 (a 0 would be a −100 % reaction)', () => {
    const bad = kline(DAY + MIN, 1);
    bad[4] = 'oops';
    const zero = kline(DAY + 2 * MIN, 0);
    expect(barsFromKlines([kline(DAY, 1), bad, zero]).map((b) => b.openTime)).toEqual([DAY]);
  });
});

describe('the one request per measurement, and its documented weight', () => {
  it.each([
    ['15m', 16, 1],
    ['1h', 61, 1], // S8 / the row say 2; 61 < 100 is 1 by the documented steps
    ['4h', 241, 2],
  ] as const)('%s: limit %i (minutes + 1), weight %i', (horizon, limit, weight) => {
    const anchor = new Date(DAY + 10 * MIN + 30_000);
    const request = klinesRequest(reactionWindow(anchor, horizon));
    expect(request.limit).toBe(limit);
    expect(klinesWeight(request.limit)).toBe(weight);
  });

  it('starts at the minute containing the anchor and ends at window.to', () => {
    const anchor = new Date(DAY + 10 * MIN + 30_000);
    const window = reactionWindow(anchor, '15m');
    expect(klinesRequest(window)).toEqual({ startTime: DAY + 10 * MIN, endTime: window.to.getTime(), limit: 16 });
  });

  it('the documented weight steps (Binance docs, not measured): 1 / 2 / 5 / 10', () => {
    expect([1, 99, 100, 499, 500, 1000, 1001, 1500].map(klinesWeight)).toEqual([1, 1, 2, 2, 5, 5, 10, 10]);
  });

  it('three horizons cost 4 per tagged symbol (1 + 1 + 2), within S8\'s stated bound of 5', () => {
    const anchor = new Date(DAY);
    const total = (['15m', '1h', '4h'] as const).reduce((sum, h) => sum + klinesWeight(klinesRequest(reactionWindow(anchor, h)).limit), 0);
    expect(total).toBe(4);
  });
});
