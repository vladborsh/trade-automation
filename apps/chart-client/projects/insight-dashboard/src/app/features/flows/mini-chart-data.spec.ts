import { describe, expect, it } from 'vitest';
import { toLineData } from './mini-chart-data';

describe('toLineData (IB-091)', () => {
  it('sorts, keeps the last value for a repeated time, and drops non-finite values', () => {
    expect(toLineData([{ time: 3, value: 3 }, { time: 1, value: 1 }, { time: 3, value: 4 }, { time: 2, value: Number.NaN }]))
      .toEqual([{ time: 1, value: 1 }, { time: 3, value: 4 }]);
  });
});
