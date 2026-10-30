import { atRightEdge, carriedOffset } from './carried-view';

const minutes = (from: number, n: number) => Array.from({ length: n }, (_, i) => (from + i) * 60);

describe('carriedOffset (IB-066)', () => {
  const before = minutes(0, 100);

  it('at the right edge the reader follows: same offset from the newest bar', () => {
    expect(carriedOffset({ extendsLater: true }, 0, before, minutes(0, 101))).toBe(0);
    // the library's own right offset (empty space past the last bar) is still the right edge
    expect(carriedOffset({ extendsLater: true }, 5, before, minutes(0, 101))).toBe(5);
    expect(carriedOffset({ extendsLater: true }, -1.5, before, minutes(0, 101))).toBe(-1.5);
  });

  it('a reader who scrolled back keeps the same bars: the offset moves back by the bars added', () => {
    expect(carriedOffset({ extendsLater: true }, -40, before, minutes(0, 103))).toBe(-43);
  });

  it('the forming bar updated in place adds no slot, so nothing moves', () => {
    expect(carriedOffset({ extendsLater: true }, -40, before, minutes(0, 100))).toBe(-40);
  });

  it('earlier history arrives on the left and does not move the right edge', () => {
    expect(carriedOffset({ extendsLater: false }, -20, before, [...minutes(-30, 30), ...before])).toBe(-20);
  });
});

describe('carriedOffset with future whitespace (IB-067)', () => {
  // the library counts the offset from the last REAL candle and chartTimes leaves whitespace out,
  // so with 162 future slots the whole view sits at +162; a candle taking a slot is one slot added
  it('the current candle with the week\'s events to its right is following', () => {
    expect(carriedOffset({ extendsLater: true }, 162, minutes(0, 100), minutes(0, 101))).toBe(162);
  });

  it('scrolled back, a candle taking a whitespace slot moves the view by nothing', () => {
    expect(carriedOffset({ extendsLater: true }, -60, minutes(0, 100), minutes(0, 101))).toBe(-61);
  });
});

describe('atRightEdge', () => {
  it('up to a bar and a half back from the newest bar counts; further back does not', () => {
    expect(atRightEdge(3)).toBe(true);
    expect(atRightEdge(-1.5)).toBe(true);
    expect(atRightEdge(-1.6)).toBe(false);
  });
});
