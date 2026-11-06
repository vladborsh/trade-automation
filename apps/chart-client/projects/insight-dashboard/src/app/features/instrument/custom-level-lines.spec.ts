import { describe, expect, it } from 'vitest';
import { CUSTOM_LEVEL_TITLE_MAX, customLevelLines } from './custom-level-lines';
import { CUSTOM_LEVEL_COLOUR } from './prior-levels';

/** IB-128 — the custom levels' lines on the price pane. */
describe('customLevelLines (IB-128)', () => {
  it('one line per level, titled with its id and note', () => {
    expect(customLevelLines([{ id: 7, price: 72_000, note: 'range high' }, { id: 8, price: 65_000, note: null }], false)).toEqual([
      { price: 72_000, title: '#7 range high', colour: CUSTOM_LEVEL_COLOUR },
      { price: 65_000, title: '#8', colour: CUSTOM_LEVEL_COLOUR },
    ]);
  });

  it('none while the switch is off, or without the read', () => {
    expect(customLevelLines([{ id: 7, price: 1, note: null }], true)).toEqual([]);
    expect(customLevelLines(undefined, false)).toEqual([]);
  });

  it('a long note is cut on the axis', () => {
    const [line] = customLevelLines([{ id: 7, price: 1, note: 'x'.repeat(50) }], false);
    expect(line.title).toHaveLength(CUSTOM_LEVEL_TITLE_MAX);
    expect(line.title.endsWith('…')).toBe(true);
  });
});
