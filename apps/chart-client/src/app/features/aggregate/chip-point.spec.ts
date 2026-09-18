import { ALL, aggPoint } from './aggregate-test-points';
import { chipPoint } from './chip-point';

const TF = 300_000;
const points = [aggPoint(0, ALL), aggPoint(TF, ALL), aggPoint(3 * TF, ALL)]; // no bar at 2·TF (dropped)

describe('chipPoint (aggregate-oi.md §1 point 3 — the bar the chip describes)', () => {
  it('is the last bar when not hovering', () => {
    expect(chipPoint(points, null, TF)).toBe(points[2]);
  });

  it('is the bar whose bucket contains the crosshair', () => {
    expect(chipPoint(points, 0, TF)).toBe(points[0]);
    expect(chipPoint(points, TF + 10, TF)).toBe(points[1]);
    expect(chipPoint(points, 3 * TF + TF - 1, TF)).toBe(points[2]);
  });

  it('is null over a slot with no bar, never the neighbouring bar', () => {
    expect(chipPoint(points, 2 * TF + 5, TF)).toBeNull();
    expect(chipPoint(points, -1, TF)).toBeNull();
  });

  it('is null for an empty series', () => {
    expect(chipPoint([], null, TF)).toBeNull();
  });
});
