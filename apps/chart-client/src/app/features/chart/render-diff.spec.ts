import { renderDiff } from './render-diff';

describe('renderDiff', () => {
  it('the same count or one more is an update of the last bar', () => {
    expect(renderDiff(10, 5_000, 10, 5_000)).toBe('update'); // the forming bar changed
    expect(renderDiff(10, 5_000, 11, 6_000)).toBe('update'); // a bar appended
  });

  it('more than one extra bar with the newest unchanged is a prepend (scroll-back)', () => {
    expect(renderDiff(10, 5_000, 510, 5_000)).toBe('prepend');
  });

  it('first data, a shrink or a jump with a new newest bar is a full replace', () => {
    expect(renderDiff(0, null, 300, 5_000)).toBe('replace');
    expect(renderDiff(10, 5_000, 4, 5_000)).toBe('replace');
    expect(renderDiff(10, 5_000, 300, 9_000)).toBe('replace');
  });
});
