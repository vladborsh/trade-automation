import { CHART_OPTIONS, CHART_PALETTE, PRICE_CANDLE_OPTIONS } from './chart-theme';
import { METRIC_DOWN_COLOR, METRIC_UP_COLOR } from './metric-series-style';

describe('chart-theme (§12.1)', () => {
  it('turns the grid off on every panel', () => {
    expect(CHART_OPTIONS.grid?.vertLines?.visible).toBe(false);
    expect(CHART_OPTIONS.grid?.horzLines?.visible).toBe(false);
  });

  it('paints price candles white up / blue down on body, border and wick', () => {
    expect(CHART_PALETTE.up).toBe('#ffffff');
    expect(CHART_PALETTE.down).toBe('#2962ff');
    expect(PRICE_CANDLE_OPTIONS).toMatchObject({
      upColor: CHART_PALETTE.up,
      downColor: CHART_PALETTE.down,
      borderVisible: true,
      borderUpColor: CHART_PALETTE.up,
      borderDownColor: CHART_PALETTE.down,
      wickUpColor: CHART_PALETTE.up,
      wickDownColor: CHART_PALETTE.down,
    });
  });

  it('gives OI candles the same up/down pair', () => {
    expect(METRIC_UP_COLOR).toBe(CHART_PALETTE.up);
    expect(METRIC_DOWN_COLOR).toBe(CHART_PALETTE.down);
  });
});
