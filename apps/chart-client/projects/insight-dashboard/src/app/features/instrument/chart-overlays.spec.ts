import { describe, expect, it } from 'vitest';
import { badgeBox } from './chart-overlays';

/** IB-099 item 1 — the badge is a real target: ≥ 24 px on a desktop, ≥ 40 px on a phone. */
describe('badgeBox', () => {
  it('desktop: 24 px, centred on the line, its bottom on the price pane\'s bottom', () => {
    expect(badgeBox(300, 400, 1100)).toEqual({ left: 288, top: 374, size: 24 });
  });
  it('a phone-width chart: 40 px', () => {
    expect(badgeBox(100, 300, 358)).toEqual({ left: 80, top: 258, size: 40 });
  });
  it('a container not laid out yet (width 0) gets the desktop size, not a zero-size target', () => {
    expect(badgeBox(0, 100, 0).size).toBe(24);
  });
});
