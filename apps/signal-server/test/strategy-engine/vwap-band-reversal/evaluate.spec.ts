import { evaluate } from '../../../src/strategy-engine/strategies/vwap-band-reversal/vwap-band-reversal.evaluate';
import { bar } from './test-helpers';

const MIN = 60_000;

const params = {
  minVwapAtrRatio: 2.5,
  maxVwapAtrRatio: 11.5,
  maxIfvgToAtrRatio: 8,
  targetRr: 3,
  rangeBars: 200,
  atrBars: 20,
};

describe('vwap-band-reversal evaluate() — the parity surface (architecture/vwap-band-reversal-plugin.md §2.3)', () => {
  it('n < 6 bars in the main window produces an error result, not a crash', () => {
    const mainWindow = Array.from({ length: 5 }, (_, i) => bar(i * MIN, { open: 1, high: 1, low: 1, close: 1 }));
    const biasWindow = mainWindow;
    const now = mainWindow[mainWindow.length - 1].openTime;

    expect(() => evaluate(mainWindow, biasWindow, now, params)).not.toThrow();
    const out = evaluate(mainWindow, biasWindow, now, params);

    expect(out.err).toBe(true);
    expect(out.sell).toBe(false);
    expect(out.buy).toBe(false);
    expect(out.n).toBe(5);
  });

  it('an empty main window is an error result even when the bias window is non-empty', () => {
    const biasWindow = [bar(0, { open: 10, high: 10, low: 10, close: 10 })];
    const out = evaluate([], biasWindow, 0, params);
    expect(out.err).toBe(true);
    expect(out.sell).toBe(false);
    expect(out.buy).toBe(false);
  });

  it('an empty bias window is an error result (Researcher D-18: VWAP([]) crashes the bot)', () => {
    const mainWindow = Array.from({ length: 10 }, (_, i) => bar(i * MIN, { open: 1, high: 1, low: 1, close: 1 }));
    const now = mainWindow[mainWindow.length - 1].openTime;
    const out = evaluate(mainWindow, [], now, params);
    expect(out.err).toBe(true);
    expect(out.vwap).toBeUndefined();
    expect(out.nBias).toBe(0);
  });

  it('still exposes the VWAP band when the main window errors (n<6) but the bias window is healthy', () => {
    // architecture/vwap-band-reversal-plugin.md §2.6: indicators are emitted whenever B is
    // non-empty, independent of the mechanic's main-window error state.
    const mainWindow = Array.from({ length: 3 }, (_, i) => bar(i * MIN, { open: 1, high: 1, low: 1, close: 1 }));
    const biasWindow = [
      bar(0, { open: 10, high: 10, low: 10, close: 10 }, 2),
      bar(MIN, { open: 12, high: 12, low: 12, close: 12 }, 1),
    ];
    const now = mainWindow[mainWindow.length - 1].openTime;

    const out = evaluate(mainWindow, biasWindow, now, params);

    expect(out.err).toBe(true);
    expect(out.nBias).toBe(2);
    expect(out.vwap).toBeDefined();
  });

  it('does not compute a stop/target when the 200-bar range is undefined (n<201), but still reports the trigger booleans', () => {
    // n=10 is far below the 201-bar range floor; with an artificially rigged bias/atr/fvg/sweep
    // setup that satisfies every other gate, `sell` (or `buy`) can read true in the parity
    // vector while stop/target stay undefined — the strategy must then emit no Signal.
    const mainWindow = Array.from({ length: 10 }, (_, i) => bar(i * MIN, { open: 100, high: 100, low: 100, close: 100 }));
    const biasWindow = [bar(0, { open: 200, high: 200, low: 200, close: 200 }, 1)];
    const now = mainWindow[mainWindow.length - 1].openTime;

    const out = evaluate(mainWindow, biasWindow, now, params);

    expect(out.rangeTop).toBeUndefined();
    expect(out.rangeBottom).toBeUndefined();
    expect(out.stop).toBeUndefined();
    expect(out.target).toBeUndefined();
  });
});
