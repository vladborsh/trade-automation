import type { LogicalRange } from 'lightweight-charts';
import { atRightEdge, carriedView } from './carried-view';

const range = (from: number, to: number) => ({ from, to }) as LogicalRange;
const minutes = (from: number, n: number) => Array.from({ length: n }, (_, i) => (from + i) * 60);

describe('carriedView', () => {
  const before = minutes(0, 100); // slots 0..99

  it('a fresh load shows the whole window: no view to carry', () => {
    expect(carriedView({}, range(80, 99), before, minutes(0, 101))).toBeNull();
    expect(carriedView({ extendsLater: true }, null, before, minutes(0, 101))).toBeNull();
  });

  it('IB-066: at the right edge, a new bar moves the view right by one, keeping the zoom', () => {
    expect(carriedView({ extendsLater: true }, range(80, 99), before, minutes(0, 101))).toEqual(range(81, 100));
    // the library's right offset leaves empty space past the last bar: still the right edge
    expect(carriedView({ extendsLater: true }, range(85, 104), before, minutes(0, 101))).toEqual(range(86, 105));
  });

  it('IB-066: the forming bar updated in place adds no slot, and the view stays put', () => {
    expect(carriedView({ extendsLater: true }, range(80, 99), before, minutes(0, 100))).toEqual(range(80, 99));
  });

  it('IB-066: a reader who scrolled back keeps exactly what they look at', () => {
    expect(carriedView({ extendsLater: true }, range(20, 60), before, minutes(0, 103))).toEqual(range(20, 60));
  });

  it('IB-066: a catch-up of many bars follows by all of them', () => {
    expect(carriedView({ extendsLater: true }, range(50, 99), before, minutes(0, 160))).toEqual(range(110, 159));
  });

  it('earlier history still shifts by the slots prepended (shiftedView)', () => {
    const after = [...minutes(-30, 30), ...before];
    expect(carriedView({ extendsPrevious: true }, range(-5, 40), before, after)).toEqual(range(25, 70));
  });
});

describe('atRightEdge', () => {
  it('within a bar and a half of the last slot counts; further back does not', () => {
    expect(atRightEdge(range(0, 99), 100)).toBe(true);
    expect(atRightEdge(range(0, 97.5), 100)).toBe(true);
    expect(atRightEdge(range(0, 97.4), 100)).toBe(false);
  });
});
