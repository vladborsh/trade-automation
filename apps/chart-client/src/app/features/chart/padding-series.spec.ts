import { vi } from 'vitest';
import { LineSeries, type IChartApi } from 'lightweight-charts';
import { PADDING_PRICE_SCALE, PaddingSeries } from './padding-series';

function fakeChart() {
  const series = { setData: vi.fn(), update: vi.fn() };
  const chart = { addSeries: vi.fn(() => series) };
  return { chart: chart as unknown as IChartApi, raw: chart, series };
}

describe('PaddingSeries (T-056)', () => {
  it('a hidden line on its own price scale: no values shown, no marker, never on the candles\' axis', () => {
    const { chart, raw } = fakeChart();
    new PaddingSeries().attach(chart);
    expect(raw.addSeries).toHaveBeenCalledWith(LineSeries, {
      visible: false, priceScaleId: PADDING_PRICE_SCALE, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });
  });

  it('one point per padded time (seconds), value 0; an unchanged list is not re-set; an empty one clears', () => {
    const { chart, series } = fakeChart();
    const padding = new PaddingSeries();
    padding.attach(chart);
    padding.render([600_000, 900_000]);
    expect(series.setData).toHaveBeenLastCalledWith([{ time: 600, value: 0 }, { time: 900, value: 0 }]);
    padding.render([600_000, 900_000]);
    expect(series.setData).toHaveBeenCalledTimes(1);
    padding.render([600_000, 900_000, 1_200_000]); // a step into the next bucket on a closed market: one point
    expect(series.update).toHaveBeenCalledWith({ time: 1200, value: 0 });
    expect(series.setData).toHaveBeenCalledTimes(1);
    padding.render([300_000, 600_000, 900_000, 1_200_000]); // older history loaded: the whole list
    expect(series.setData).toHaveBeenCalledTimes(2);
    padding.render([]); // no bars
    expect(series.setData).toHaveBeenLastCalledWith([]);
  });

  it('an interior change with the same length and ends is a change: the whole list is set again', () => {
    const { chart, series } = fakeChart();
    const padding = new PaddingSeries();
    padding.attach(chart);
    padding.render([600_000, 900_000, 1_500_000]);
    padding.render([600_000, 1_200_000, 1_500_000]); // same length, first and last; the middle moved
    expect(series.setData).toHaveBeenCalledTimes(2);
    expect(series.setData).toHaveBeenLastCalledWith([{ time: 600, value: 0 }, { time: 1200, value: 0 }, { time: 1500, value: 0 }]);
    padding.render([600_000, 1_200_000, 1_500_000]); // truly unchanged: left alone
    expect(series.setData).toHaveBeenCalledTimes(2);
    padding.render([600_000, 900_000, 1_500_000, 1_800_000]); // one more at the end, but the middle differs: not an append
    expect(series.update).not.toHaveBeenCalled();
    expect(series.setData).toHaveBeenCalledTimes(3);
  });

  it('does nothing before it is attached', () => {
    expect(() => new PaddingSeries().render([600_000])).not.toThrow();
  });
});
