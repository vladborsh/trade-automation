import { Candle } from '@trade-automation/contracts';
import { INDICATOR_CATALOG, computeFvg, ifvgBoxes, ifvgRect, indicatorById } from '../src';
import real from './fixtures/btcusdt-1m-2days.json';
import { bar } from './test-helpers';

/**
 * T-057 — every inverse FVG as a box (`ifvgBoxes`) and the catalogue's `fvg` entry drawing them as
 * `rect` overlays. Correct = the lifted `computeFvg`: at the end of any prefix, the live boxes of
 * each side are exactly its live iFVG lists (counts), and its latest iFVG is one of them.
 */

const MIN = 60_000;

// fvg.spec.ts's first case: a bearish FVG {low 94, high 95} formed at i=3 (bars 1..3), inverted at i=4
const inverted = [
  bar(0 * MIN, { open: 50, high: 51, low: 49, close: 50 }),
  bar(1 * MIN, { open: 100, high: 100, low: 95, close: 98 }),
  bar(2 * MIN, { open: 96, high: 97, low: 93, close: 95 }),
  bar(3 * MIN, { open: 92, high: 94, low: 88, close: 90 }),
  bar(4 * MIN, { open: 90, high: 97, low: 85, close: 96 }),
];
// …then a bar that opens above and closes below its bottom (94): the bullish iFVG is pruned at i=5
const pruned = [...inverted, bar(5 * MIN, { open: 96, high: 96.5, low: 92, close: 93 }), bar(6 * MIN, { open: 93, high: 93.5, low: 92.5, close: 93 })];

describe('ifvgBoxes (T-057)', () => {
  it('a live inverse FVG: from the gap’s first bar to the last bar, its edges, bullish (an inverted bearish gap)', () => {
    expect(ifvgBoxes(inverted)).toEqual([{ from: 1 * MIN, to: 4 * MIN, top: 95, bottom: 94, side: 'bullish', live: true }]);
  });

  it('a pruned one ends at the bar that pruned it and is no longer live', () => {
    expect(ifvgBoxes(pruned)).toEqual([{ from: 1 * MIN, to: 5 * MIN, top: 95, bottom: 94, side: 'bullish', live: false }]);
    expect(computeFvg(pruned).nBullIfvg).toBe(0); // the lifted function agrees: nothing live
  });

  it('no bars, or too few for a gap: no boxes', () => {
    expect(ifvgBoxes([])).toEqual([]);
    expect(ifvgBoxes(inverted.slice(0, 3))).toEqual([]);
  });

  it('parity with the lifted computeFvg on 2880 real 1m bars, at prefixes across the day: live counts per side and the latest box', () => {
    const bars: Candle[] = (real.bars as number[][]).map(([openTime, open, high, low, close, volume]) => ({
      instrument: 'binance:BTCUSDT', timeframe: '1m', openTime, open, high, low, close, volume, closed: true, source: 'venue-rest',
    }));
    let checked = 0;
    let withLatest = 0;
    for (let end = 50; end <= bars.length; end += 283) {
      const prefix = bars.slice(0, end);
      const boxes = ifvgBoxes(prefix);
      const lifted = computeFvg(prefix);
      const live = boxes.filter((b) => b.live);
      expect({ end, bullish: live.filter((b) => b.side === 'bullish').length, bearish: live.filter((b) => b.side === 'bearish').length }).toEqual({
        end, bullish: lifted.nBullIfvg, bearish: lifted.nBearIfvg,
      });
      expect(live.every((b) => b.to === prefix[prefix.length - 1].openTime)).toBe(true);
      expect(boxes.every((b) => b.from < b.to && b.bottom < b.top)).toBe(true);
      if (lifted.hasIfvg) {
        const from = prefix[lifted.ifvgX! - 2].openTime;
        expect({ end, latestIsLive: live.some((b) => b.from === from && b.top === lifted.ifvgHigh && b.bottom === lifted.ifvgLow) }).toEqual({ end, latestIsLive: true });
        withLatest++;
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(8);
    expect(withLatest).toBeGreaterThan(0); // the data does exercise the latest-box branch
  });
});

describe("the catalogue's fvg entry (T-057)", () => {
  const entry = indicatorById('fvg')!;

  it('draws boxes, not lines: no output series, one rect per iFVG with no label', () => {
    expect(entry.outputs).toEqual([]);
    expect(entry.compute(pruned, {})).toEqual({});
    expect(entry.overlays!(pruned, {})).toEqual([{ type: 'rect', from: 1 * MIN, to: 5 * MIN, top: 95, bottom: 94, color: 'rgba(38, 166, 154, 0.4)' }]);
    expect(entry.overlays!(inverted, {})).toEqual([{ type: 'rect', from: 1 * MIN, to: 4 * MIN, top: 95, bottom: 94, color: '#26a69a' }]);
  });

  it('colours: up/down palette by side, a live box filled, a pruned one faint', () => {
    const box = { from: 0, to: 1, top: 2, bottom: 1 };
    expect(ifvgRect({ ...box, side: 'bullish', live: true }).color).toBe('#26a69a');
    expect(ifvgRect({ ...box, side: 'bearish', live: true }).color).toBe('#ef5350');
    expect(ifvgRect({ ...box, side: 'bearish', live: false }).color).toBe('rgba(239, 83, 80, 0.4)');
    expect('label' in ifvgRect({ ...box, side: 'bullish', live: true })).toBe(false);
  });

  it("only fvg has overlays; MACD's hist is the one histogram output", () => {
    expect(INDICATOR_CATALOG.filter((e) => e.overlays).map((e) => e.id)).toEqual(['fvg']);
    const plots = INDICATOR_CATALOG.flatMap((e) => e.outputs.filter((o) => o.plot).map((o) => [e.id, o.key, o.plot]));
    expect(plots).toEqual([['macd', 'hist', 'histogram']]);
  });
});
