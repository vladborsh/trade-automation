import { atRightEdge, carriedView, type ChartView } from './carried-view';

const view = (rightOffset: number, barSpacing = 2): ChartView => ({ barSpacing, rightOffset });
const minutes = (from: number, n: number) => Array.from({ length: n }, (_, i) => (from + i) * 60);

describe('carriedView', () => {
  const before = minutes(0, 100);

  it('a fresh load shows the whole window: no view to carry', () => {
    expect(carriedView({}, view(0), before, minutes(0, 101))).toBeNull();
    expect(carriedView({ extendsLater: true }, null, before, minutes(0, 101))).toBeNull();
  });

  it('IB-066: at the right edge the reader follows — same zoom, same offset from the newest bar', () => {
    expect(carriedView({ extendsLater: true }, view(0, 3), before, minutes(0, 101))).toEqual(view(0, 3));
    // the library's own right offset (empty space past the last bar) is still the right edge
    expect(carriedView({ extendsLater: true }, view(5), before, minutes(0, 101))).toEqual(view(5));
    expect(carriedView({ extendsLater: true }, view(-1.5), before, minutes(0, 101))).toEqual(view(-1.5));
  });

  it('IB-066: a reader who scrolled back keeps the same bars: the offset moves back by the bars added', () => {
    expect(carriedView({ extendsLater: true }, view(-40, 3), before, minutes(0, 103))).toEqual(view(-43, 3));
  });

  it('IB-066: the forming bar updated in place adds no slot, so nothing moves', () => {
    expect(carriedView({ extendsLater: true }, view(-40), before, minutes(0, 100))).toEqual(view(-40));
  });

  it('earlier history keeps the view: bars arriving on the left do not move the right edge', () => {
    const after = [...minutes(-30, 30), ...before];
    expect(carriedView({ extendsPrevious: true }, view(-20, 4), before, after)).toEqual(view(-20, 4));
  });
});

describe('atRightEdge', () => {
  it('up to a bar and a half back from the newest bar counts; further back does not', () => {
    expect(atRightEdge(view(3))).toBe(true);
    expect(atRightEdge(view(-1.5))).toBe(true);
    expect(atRightEdge(view(-1.6))).toBe(false);
  });
});
