import type { OverlayPrimitive } from '@trade-automation/contracts';
import { countOverlays } from './overlay-counts';

describe('countOverlays (T-057)', () => {
  it('counts markers and rects; other primitives are not counted', () => {
    const overlays = [
      { type: 'marker', time: 1, position: 'above', shape: 'arrowDown' },
      { type: 'rect', from: 1, to: 2, top: 3, bottom: 2 },
      { type: 'rect', from: 2, to: 3, top: 4, bottom: 3 },
      { type: 'line', points: [] },
    ] as unknown as OverlayPrimitive[];
    expect(countOverlays(overlays)).toEqual({ marker: 1, rect: 2 });
    expect(countOverlays([])).toEqual({ marker: 0, rect: 0 });
  });
});
