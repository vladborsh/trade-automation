import { CandleChartData } from '../../interfaces/charts/candlestick-chart-data';
import { calculateFVG } from './fvg.indicator';

describe('FVG indicator', () => {
  it('should find simple FVGs', () => {
    const testCandleData: CandleChartData[] = [
      { openTime: 1701266400000, open: 195.0, high: 197.0, low: 194.5, close: 196.5, volume: 1200 },
      { openTime: 1701266460000, open: 196.5, high: 198.5, low: 196.0, close: 198.0, volume: 1300 },
      { openTime: 1701266520000, open: 198.0, high: 202.0, low: 197.5, close: 201.5, volume: 1400 },
      { openTime: 1701266580000, open: 201.5, high: 205.0, low: 201.0, close: 204.5, volume: 1500 },
      { openTime: 1701266640000, open: 204.5, high: 210.0, low: 204.0, close: 209.5, volume: 1600 },
      { openTime: 1701266700000, open: 209.5, high: 211.0, low: 208.5, close: 210.5, volume: 1700 },
    ];

    const result = calculateFVG(testCandleData);
    expect(result.FVGs).toEqual([
      { low: 198.5, high: 201, x: 3 },
      { low: 202, high: 204, x: 4 },
      { low: 205, high: 208.5, x: 5 },
    ]);

    expect(result.bearishIfvgOccurs).toEqual(false);
    expect(result.bearishIfvgOccurs).toEqual(false);
    expect(result.bearishIFVGs).toEqual([]);
    expect(result.bullishIFVGs).toEqual([]);
  });

  it('should find inverse FVGs', () => {
    const testCandleData: CandleChartData[] = [
      { openTime: 1701266520000, open: 198.0, high: 200.5, low: 197.5, close: 199.5, volume: 1400 },
      { openTime: 1701266580000, open: 199.5, high: 202.0, low: 199.0, close: 201.5, volume: 1500 },
      { openTime: 1701266640000, open: 201.5, high: 204.0, low: 201.0, close: 203.5, volume: 1600 },
      { openTime: 1701266700000, open: 203.5, high: 208.0, low: 203.0, close: 207.5, volume: 1700 },
      { openTime: 1701266760000, open: 207.5, high: 211.0, low: 207.0, close: 210.5, volume: 1800 },
      { openTime: 1701266820000, open: 210.5, high: 212.0, low: 209.0, close: 209.5, volume: 1900 },
      { openTime: 1701266880000, open: 209.5, high: 211.0, low: 208.0, close: 209.0, volume: 1500 },
      { openTime: 1701266940000, open: 209.0, high: 210.0, low: 207.5, close: 207.5, volume: 1400 },
      { openTime: 1701267000000, open: 207.5, high: 210.0, low: 208.0, close: 209.0, volume: 1600 },
    ];

    const result = calculateFVG(testCandleData);

    expect(result.FVGs).toEqual([
      { low: 202, high: 203, x: 3 },
      { low: 204, high: 207, x: 4 },
    ]);
    expect(result.bearishIFVGs).toEqual([{ low: 208, high: 209, x: 5 }]);
    expect(result.bearishIfvgOccurs).toEqual(false);
    expect(result.bullishIfvgOccurs).toEqual(false);
  });

  it('should identify last candle IFVG occurrence', () => {
    const testCandleData: CandleChartData[] = [
      { openTime: 1701266580000, open: 199.5, high: 202.0, low: 199.0, close: 201.5, volume: 1500 },
      { openTime: 1701266640000, open: 201.5, high: 204.0, low: 201.0, close: 203.5, volume: 1600 },
      { openTime: 1701266700000, open: 203.5, high: 208.0, low: 203.0, close: 207.5, volume: 1700 },
      { openTime: 1701266760000, open: 207.5, high: 211.0, low: 207.0, close: 210.5, volume: 1800 },
      { openTime: 1701266820000, open: 210.5, high: 212.0, low: 209.0, close: 209.5, volume: 1900 },
      { openTime: 1701266880000, open: 209.5, high: 211.0, low: 208.0, close: 209.0, volume: 1500 },
      { openTime: 1701266940000, open: 209.0, high: 210.0, low: 207.5, close: 207.5, volume: 1400 },
    ];

    const result = calculateFVG(testCandleData);

    expect(result.bearishIFVGs).toEqual([ { low: 208, high: 209, x: 4 } ]);
    expect(result.bearishIfvgOccurs).toEqual(true);
    expect(result.bullishIfvgOccurs).toEqual(false);
  });

  it('should not identify last candle IFVG occurrence if FVG crossed but not with last candle', () => {
    const testCandleData: CandleChartData[] = [
      { openTime: 1701266580000, open: 199.5, high: 202.0, low: 199.0, close: 201.5, volume: 1500 },
      { openTime: 1701266640000, open: 201.5, high: 204.0, low: 201.0, close: 203.5, volume: 1600 },
      { openTime: 1701266700000, open: 203.5, high: 208.0, low: 203.0, close: 207.5, volume: 1700 },
      { openTime: 1701266760000, open: 207.5, high: 211.0, low: 207.0, close: 210.5, volume: 1800 },
      { openTime: 1701266820000, open: 210.5, high: 212.0, low: 209.0, close: 209.5, volume: 1900 },
      { openTime: 1701266880000, open: 209.5, high: 211.0, low: 208.0, close: 209.0, volume: 1500 },
      { openTime: 1701266940000, open: 209.0, high: 210.0, low: 207.5, close: 207.5, volume: 1400 },
      { openTime: 1701267000000, open: 207.5, high: 208.0, low: 201.5, close: 204.5, volume: 1400 },
    ];

    const result = calculateFVG(testCandleData);

    expect(result.bearishIFVGs).toEqual([ { low: 208, high: 209, x: 4 } ]);
    expect(result.bearishIfvgOccurs).toEqual(false);
    expect(result.bullishIfvgOccurs).toEqual(false);
  });
});
