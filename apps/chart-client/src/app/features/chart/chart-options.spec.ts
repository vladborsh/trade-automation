import { CHART_OPTIONS, chartOptions } from './chart-options';

describe('chartOptions (T-063)', () => {
  it('no margin: the live terminal\'s options, unchanged (the same object)', () => {
    expect(chartOptions(0)).toBe(CHART_OPTIONS);
  });

  it('a margin: the right offset in pixels, every other option as before', () => {
    const options = chartOptions(160);
    expect(options.timeScale).toEqual({ ...CHART_OPTIONS.timeScale, rightOffsetPixels: 160 });
    expect({ ...options, timeScale: undefined }).toEqual({ ...CHART_OPTIONS, timeScale: undefined });
    expect(CHART_OPTIONS.timeScale).not.toHaveProperty('rightOffsetPixels'); // not mutated
  });
});
