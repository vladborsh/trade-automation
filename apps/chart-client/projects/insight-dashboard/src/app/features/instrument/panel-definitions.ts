import {
  CandlestickSeries, HistogramSeries, LineSeries, type IChartApi, type Time,
} from 'lightweight-charts';
import type { StringKey } from '../../i18n/keys';
import { LIQUIDATION_COLORS } from './liquidation-histogram.renderer';
import {
  toCandleData, toCvdSegments, toFundingSteps, toLiquidationHistogram, toLongShortLine,
  toPredictedFunding, toTakerDelta,
} from './series.adapter';
import type { PaneData } from './pane-data';

/**
 * IB-BUG-009 — the six panels of the instrument view, as data rather than as markup.
 *
 * The page used to be one chart with six panes stacked vertically; the user asked for six
 * panels **side by side in one row**, each filling the viewport height. That means six
 * independent charts, and the thing that makes six charts tolerable is that each one is
 * described here instead of being hand-wired in a component — the row component just renders
 * whatever this returns, so adding or reordering a panel is a change to a list.
 *
 * **Each chart scales itself.** Separate charts mean separate price scales, which is the point:
 * when everything shared one scale, open interest at 10^9 flattened BTC's candles at 10^4
 * (IB-031), and the liquidation bars anchored at zero dragged the price scale down with them.
 * Here nothing is fixed and nothing is zero-based except the histogram, where zero is the real
 * baseline — lightweight-charts then autoscales each to its own visible data, and re-fits on
 * scroll and zoom without being asked.
 */

export interface PanelLegendItem {
  labelKey: StringKey;
  color: string;
}

export interface PanelDef {
  id: string;
  titleKey: StringKey;
  legend: PanelLegendItem[];
  /** Draws the panel's series into a fresh chart. Called once per data change. */
  draw: (chart: IChartApi) => void;
}

const UP = '#26a69a';
const DOWN = '#ef5350';
const TEXT = '#c9d1d9';
const MUTED = '#8b949e';

/** lightweight-charts wants its own point type; our adapters emit the same shape. */
const asData = <T>(rows: readonly T[]) => rows as unknown as Array<{ time: Time; value: number }>;

export function buildPanels(data: PaneData): PanelDef[] {
  return [
    {
      id: 'price',
      titleKey: 'panel.price',
      legend: [],
      draw: (chart) => {
        chart
          .addSeries(CandlestickSeries, {
            upColor: UP, downColor: DOWN, borderVisible: false,
            wickUpColor: UP, wickDownColor: DOWN,
          })
          .setData(toCandleData(data.candles.candles) as never);
      },
    },
    {
      id: 'oi',
      titleKey: 'panel.oi',
      legend: [],
      draw: (chart) => {
        // the USD notional side, which is what the number means to a reader; a point without
        // one is simply absent rather than drawn as a base-unit figure on a USD scale
        const points = data.openInterest
          .filter((p) => p.notional !== null)
          .map((p) => ({ time: p.time as Time, value: p.notional as number }));
        chart.addSeries(LineSeries, { color: '#58a6ff', lineWidth: 2 }).setData(points);
      },
    },
    {
      id: 'liquidations',
      titleKey: 'panel.liquidations',
      legend: [
        { labelKey: 'legend.longs', color: LIQUIDATION_COLORS.long },
        { labelKey: 'legend.shorts', color: LIQUIDATION_COLORS.short },
      ],
      draw: (chart) => {
        const { longs, shorts } = toLiquidationHistogram(data.liquidations.bars, LIQUIDATION_COLORS);
        const options = { priceFormat: { type: 'volume' as const }, lastValueVisible: false, priceLineVisible: false };
        // one scale for both, so a long cascade visibly dwarfs the shorts instead of each side
        // being autoscaled to fill its own half — the only panel where zero is a real baseline
        chart.addSeries(HistogramSeries, { ...options, color: LIQUIDATION_COLORS.long }).setData(longs as never);
        chart.addSeries(HistogramSeries, { ...options, color: LIQUIDATION_COLORS.short }).setData(shorts as never);
      },
    },
    {
      id: 'cvd',
      titleKey: 'panel.cvd',
      legend: [
        { labelKey: 'legend.cvd', color: TEXT },
        { labelKey: 'legend.delta', color: MUTED },
      ],
      draw: (chart) => {
        chart.addSeries(HistogramSeries, {
          color: MUTED, priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false,
        }).setData(asData(toTakerDelta(data.candles.candles)) as never);
        // one series per segment: a gap in the taker data stays a gap rather than a straight
        // line across an outage (series.adapter)
        for (const segment of toCvdSegments(data.candles.candles)) {
          chart.addSeries(LineSeries, { color: TEXT, lineWidth: 2, lastValueVisible: false })
            .setData(asData(segment) as never);
        }
      },
    },
    {
      id: 'funding',
      titleKey: 'panel.funding',
      legend: [
        { labelKey: 'legend.settled', color: UP },
        { labelKey: 'legend.predicted', color: MUTED },
      ],
      draw: (chart) => {
        for (const venue of data.funding.settled) {
          chart.addSeries(LineSeries, { color: UP, lineWidth: 1, lastValueVisible: false })
            .setData(asData(toFundingSteps(venue.points)) as never);
        }
        chart.addSeries(LineSeries, { color: MUTED, lineWidth: 1, lineStyle: 2, lastValueVisible: false })
          .setData(asData(toPredictedFunding(data.funding)) as never);
      },
    },
    {
      id: 'long-short',
      titleKey: 'panel.longShort',
      legend: [],
      draw: (chart) => {
        chart.addSeries(LineSeries, { color: TEXT, lineWidth: 2 })
          .setData(asData(toLongShortLine(data.longShort)) as never);
      },
    },
  ];
}
