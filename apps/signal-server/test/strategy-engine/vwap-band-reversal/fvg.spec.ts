import { computeFvg } from '../../../src/strategy-engine/strategies/vwap-band-reversal/indicators/fvg';
import { bar } from './test-helpers';

const MIN = 60_000;

describe('vwap-band-reversal FVG (knowledge/vwap-band-reversal-ict.md §3, Researcher D-03)', () => {
  it('forms a bearish FVG at i=3 and inverts it through the proximal edge at i=4 -> bullishIfvgOccurs', () => {
    // i=3 vs i-2=1: bearish box requires current.close < prev.open && current.high < prev.low.
    const bars = [
      bar(0 * MIN, { open: 50, high: 51, low: 49, close: 50 }), // 0: unused (i<=2 skipped)
      bar(1 * MIN, { open: 100, high: 100, low: 95, close: 98 }), // 1: prev for i=3 — open=100, low=95
      bar(2 * MIN, { open: 96, high: 97, low: 93, close: 95 }), // 2: prev for i=4 — chosen so detect(4,·,·) forms nothing
      bar(3 * MIN, { open: 92, high: 94, low: 88, close: 90 }), // 3: current for i=3 — close=90<100, high=94<95 -> bearish box {low:94, high:95, x:3}
      bar(4 * MIN, { open: 90, high: 97, low: 85, close: 96 }), // 4: current for i=4 — open=90<95 && close=96>95 -> inverts the box
    ];

    const result = computeFvg(bars);

    expect(result.bullOcc).toBe(true); // bullishIfvgOccurs: a bearish FVG was inverted by the last bar
    expect(result.bearOcc).toBe(false);
    expect(result.nBullIfvg).toBe(1);
    expect(result.nBearIfvg).toBe(0);
    expect(result.hasIfvg).toBe(true);
    expect(result.ifvgLow).toBe(94);
    expect(result.ifvgHigh).toBe(95);
    expect(result.ifvgX).toBe(3);
  });

  it('forms a bullish FVG and inverts it -> bearishIfvgOccurs is true, but D-03 still makes lastIFVG undefined', () => {
    // Not a true mirror of the bearish-forms-inverts case: when the ONLY populated iFVG list
    // is the bearish one (bullish stays empty), `hasIfvg` is false regardless — this is the
    // same D-03 asymmetry from a different angle, not a separate bug.
    const bars = [
      bar(0 * MIN, { open: 50, high: 51, low: 49, close: 50 }),
      bar(1 * MIN, { open: 90, high: 91, low: 85, close: 88 }), // prev for i=3 — open=90, high=91
      bar(2 * MIN, { open: 85, high: 90, low: 80, close: 85 }), // prev for i=4 — chosen so detect(4,·,·) forms nothing
      bar(3 * MIN, { open: 92, high: 96, low: 93, close: 95 }), // current for i=3 — close=95>90, low=93>91 -> bullish box {low:91, high:93, x:3}
      bar(4 * MIN, { open: 95, high: 97, low: 84, close: 85 }), // current for i=4 — open=95>91 && close=85<91 -> inverts the box
    ];

    const result = computeFvg(bars);

    expect(result.bearOcc).toBe(true); // bearishIfvgOccurs: a bullish FVG was inverted by the last bar
    expect(result.bullOcc).toBe(false);
    expect(result.nBullIfvg).toBe(0);
    expect(result.nBearIfvg).toBe(1);
    expect(result.hasIfvg).toBe(false); // D-03: bullish iFVG list is empty -> lastIFVG undefined
    expect(result.ifvgLow).toBeUndefined();
    expect(result.ifvgHigh).toBeUndefined();
  });

  it("Researcher D-03: asymmetric lastIFVG — an empty bullish iFVG list makes lastIFVG undefined regardless of the bearish list's contents", () => {
    // Same fixture as the bearish-iFVG-only case above: bearishIFvg has one entry, bullishIFvg
    // is empty. The bot's getLastIfvg indexes bearishIFvgArray[bullishIFvgArray.length - 1],
    // i.e. bearish[-1], which is always undefined when bullish is empty — NOT
    // bearish[bearish.length - 1] (the "obviously correct" fix). Pinned here on purpose.
    const bars = [
      bar(0 * MIN, { open: 50, high: 51, low: 49, close: 50 }),
      bar(1 * MIN, { open: 90, high: 91, low: 85, close: 88 }),
      bar(2 * MIN, { open: 85, high: 90, low: 80, close: 85 }),
      bar(3 * MIN, { open: 92, high: 96, low: 93, close: 95 }),
      bar(4 * MIN, { open: 95, high: 97, low: 84, close: 85 }),
    ];

    const result = computeFvg(bars);

    expect(result.nBullIfvg).toBe(0);
    expect(result.nBearIfvg).toBe(1); // the bearish list is non-empty ...
    expect(result.hasIfvg).toBe(false); // ... yet lastIFVG is still undefined
    expect(result.ifvgLow).toBeUndefined();
    expect(result.ifvgHigh).toBeUndefined();
  });

  it('reports no FVG activity on fewer than 4 bars (the loop requires i > 2)', () => {
    const bars = [
      bar(0 * MIN, { open: 1, high: 1, low: 1, close: 1 }),
      bar(1 * MIN, { open: 1, high: 1, low: 1, close: 1 }),
      bar(2 * MIN, { open: 1, high: 1, low: 1, close: 1 }),
    ];
    const result = computeFvg(bars);
    expect(result).toMatchObject({ bullOcc: false, bearOcc: false, nBullIfvg: 0, nBearIfvg: 0, hasIfvg: false });
  });
});
