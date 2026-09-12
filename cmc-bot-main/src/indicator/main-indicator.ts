import { Subject } from 'rxjs';
import { LineTitleLocation, PlotLine, PlotLineStyle } from './interfaces/plot-line';
import { ShapeLocation } from './interfaces/plot-shape';
import { ScriptVarFactory } from './tools/script-var-factory';
import { TA } from './tools/tech-analysis';
import { PlotsBuilder } from './tools/plot-builder';
import { LineBuilder } from './tools/line-builder';
import { PlotShapesBuilder } from './tools/plot-sahape-builder';
import { SmartMoneyIndicatorData } from './dto/sm-indicator-response';
import { HorizontalLineBuilder } from './tools/horizontal-line-builder';
import { VerticalLineBuilder } from './tools/vertical-line-builder';
import {
  isDayTrueOpen,
  isNewYorkAMTrueOpen,
  isNewYorkExchangeOpen,
  isPrevMonth,
  isPrevWeek,
  isSameDayWithLastCandle,
  isTimeAfter,
  isTimeBefore,
  isTrueOpenOfMonth,
  isTrueOpenOfWeek,
  isYesterdayWithLastCandle,
} from './tools/date-helpers';
import { SmIndicatorInputs } from './dto/sm-indicator-request';
import { Trend } from './enums';
import { Swings } from './functions/swings';
import { YinDiscount } from './functions/y-in-discount';
import { RayLineBuilder } from './tools/ray-builder';
import { drawHighPremiumDiscount, drawPremiumDiscount } from './indicator-functions';
import { Nullable } from '../types/types';
import { CandleChartData } from '../interfaces/charts/candlestick-chart-data';
import { FvgCalculator, convertFvfToRenderable } from './tools/fvg-element';

export function indicatorScript(
  chartData: CandleChartData[],
  inputs?: SmIndicatorInputs
): SmartMoneyIndicatorData {
  const onIterationEnd$ = new Subject<number>();
  const onIteration$ = new Subject<number>();
  const varFactory = new ScriptVarFactory(onIteration$, onIterationEnd$);
  const fvgCalculator = new FvgCalculator();

  const lastCandle = chartData[chartData.length - 1];

  const H_SWING_LENGTH = inputs?.highStructureLength || 60;
  const SWING_LENGTH = inputs?.structureLength || 15;
  const I_SWING_LENGTH = inputs?.internalStructureLength || 3;
  const EQ_THRESHOLD_ATR = inputs?.EQThreshold || 200;

  const plots = new PlotsBuilder();
  const plotShapes = new PlotShapesBuilder();
  const lines = new LineBuilder();
  const hlines = new HorizontalLineBuilder();
  const vlines = new VerticalLineBuilder();
  const raylines = new RayLineBuilder();
  const alerts: string[] = [];

  plotShapes.make('short', '#333333', ShapeLocation.ABOVE);
  plotShapes.make('long', '#333333', ShapeLocation.BELOW);

  plots.make('top_y', '#eeee77');

  const open = varFactory.var(chartData[0].open);
  const high = varFactory.var(chartData[0].high);
  const low = varFactory.var(chartData[0].low);
  const close = varFactory.var(chartData[0].close);
  const openTime = varFactory.var(chartData[0].openTime);

  const trend = varFactory.var(Trend.NONE);
  const itrend = varFactory.var(Trend.NONE);

  const top_y = varFactory.var(0);
  const top_x = varFactory.var(0);
  const trail_up = varFactory.var(0);
  const trail_up_x = varFactory.var(0);
  const itop_y = varFactory.var(0);
  const h_top_y = varFactory.var(0);
  const h_top_x = varFactory.var(0);
  const h_trail_up = varFactory.var(0);
  const h_trail_up_x = varFactory.var(0);

  const btm_y = varFactory.var(0);
  const btm_x = varFactory.var(0);
  const trail_dn = varFactory.var(0);
  const trail_dn_x = varFactory.var(0);
  const ibtm_y = varFactory.var(0);
  const h_btm_y = varFactory.var(0);
  const h_btm_x = varFactory.var(0);
  const h_trail_dn = varFactory.var(0);
  const h_trail_dn_x = varFactory.var(0);


  const LINE_LENGTH = 15;
  const K = 1;
  const upper = varFactory.var(0);
  const lower = varFactory.var(0);
  const slope_ph = varFactory.var(0);
  const slope_pl = varFactory.var(0);
  const up_l = varFactory.var<Nullable<PlotLine>>(null);
  const dn_l = varFactory.var<Nullable<PlotLine>>(null);
  const ph = varFactory.var<number | undefined>(undefined);
  const pl = varFactory.var<number | undefined>(undefined);

  let PDH: Nullable<number> = null;
  let PDHbarIndex: Nullable<number> = null;
  let PDL: Nullable<number> = null;
  let PDLbarIndex: Nullable<number> = null;
  let PWH: Nullable<number> = null;
  let PWHbarIndex: Nullable<number> = null;
  let PWL: Nullable<number> = null;
  let PWLbarIndex: Nullable<number> = null;
  let PMH: Nullable<number> = null;
  let PMHbarIndex: Nullable<number> = null;
  let PML: Nullable<number> = null;
  let PMLbarIndex: Nullable<number> = null;
  let lastNYAmTrueOpen: Nullable<number> = null;
  let lastDayTrueOpen: Nullable<number> = null;
  let lastNYExchangeOpen: Nullable<number> = null;

  let londonMinimum: Nullable<number> = null;
  let londonMinimumBarIndex: Nullable<number> = null;
  let londonMaximum: Nullable<number> = null;
  let londonMaximumBarIndex: Nullable<number> = null;
  let isLondonHighTaken: boolean = false;
  let isLondonLowTaken: boolean = false;

  const swingFn = new Swings(SWING_LENGTH, chartData, high, low);
  const h_swingFn = new Swings(H_SWING_LENGTH, chartData, high, low);
  const isYinDiscount = new YinDiscount(h_trail_up, h_trail_dn, trail_up, trail_dn);

  /* main loop over candles */
  for (let i = 0; i <= chartData.length - 1; i++) {
    onIteration$.next(i);
    const bar_index = i;
    const is_last_bar = i === chartData.length - 1;

    fvgCalculator.calculateStep(i, chartData, open.get(), close.get());

    if (i > Math.max(H_SWING_LENGTH, SWING_LENGTH, I_SWING_LENGTH, EQ_THRESHOLD_ATR)) {
      const [top, btm] = swingFn.calculate(i);
      const [h_top, h_btm] = h_swingFn.calculate(i);

      /* liquidity Lines */
      ph.set(TA.pivothigh(chartData, LINE_LENGTH, LINE_LENGTH, bar_index));
      pl.set(TA.pivotlow(chartData, LINE_LENGTH, LINE_LENGTH, bar_index));
      const slope = (TA.stddev(close, LINE_LENGTH) / LINE_LENGTH) * K;

      slope_ph.set(ph.get() ? slope : slope_ph.get());
      slope_pl.set(pl.get() ? slope : slope_pl.get());
      upper.set(ph.get() ? ph.get() || 0 : upper.get() - slope_ph.get());
      lower.set(pl.get() ? pl.get() || 0 : lower.get() + slope_pl.get());

      if (ph.get(1)) {
        lines.delete(up_l.get(1) as PlotLine);
        up_l.set(lines.make(bar_index - 1, ph.get(1) || 0, bar_index, upper.get()));
      }

      if (pl.get(1)) {
        lines.delete(dn_l.get(1) as PlotLine);
        dn_l.set(lines.make(bar_index - 1, pl.get(1) || 0, bar_index, lower.get()));
      }
      /* liquidity Lines (end) */

      if (h_top) {
        h_top_y.set(h_top);
        h_top_x.set(bar_index - H_SWING_LENGTH);
        h_trail_up.set(h_top);
        h_trail_up_x.set(bar_index - H_SWING_LENGTH);
      }

      if (top) {
        top_y.set(top);
        top_x.set(bar_index - SWING_LENGTH);
        trail_up.set(top);
        trail_up_x.set(bar_index - SWING_LENGTH);
      }

      trail_up.set(Math.max(high.get(), trail_up.get()));
      trail_up_x.set(trail_up.get() === high.get() ? bar_index : trail_up_x.get());

      h_trail_up.set(Math.max(high.get(), h_trail_up.get()));
      h_trail_up_x.set(h_trail_up.get() === high.get() ? bar_index : h_trail_up_x.get());

      if (h_btm) {
        h_btm_y.set(h_btm);
        h_btm_x.set(bar_index - H_SWING_LENGTH);
        h_trail_dn.set(h_btm);
        h_trail_dn_x.set(bar_index - H_SWING_LENGTH);
      }

      if (btm) {
        btm_y.set(btm);
        btm_x.set(bar_index - SWING_LENGTH);
        trail_dn.set(btm);
        trail_dn_x.set(bar_index - SWING_LENGTH);
      }

      trail_dn.set(trail_dn.get() === 0 ? low.get() : Math.min(low.get(), trail_dn.get()));
      trail_dn_x.set(trail_up.get() === high.get() ? bar_index : trail_up_x.get());

      h_trail_dn.set(h_trail_dn.get() === 0 ? low.get() : Math.min(low.get(), h_trail_dn.get()));
      h_trail_dn_x.set(h_trail_dn.get() === low.get() ? bar_index : h_trail_dn_x.get());
    }

    if (i > 0) {
      const currentCandleOpenPrice = chartData[i].open;
      const currentCandleOpenTime = chartData[i].openTime;
      const previousCandleOpenTime = chartData[i - 1].openTime + 1;

      if (
        isTrueOpenOfMonth(
          previousCandleOpenTime,
          currentCandleOpenTime,
          new Date(lastCandle.openTime)
        )
      ) {
        raylines.make(bar_index, currentCandleOpenPrice, undefined, undefined, 'Month true open');
      }

      if (
        isTrueOpenOfWeek(
          previousCandleOpenTime,
          currentCandleOpenTime,
          new Date(lastCandle.openTime)
        )
      ) {
        raylines.make(bar_index, currentCandleOpenPrice, undefined, undefined, 'Week true open');
      }

      if (isNewYorkAMTrueOpen(previousCandleOpenTime, currentCandleOpenTime)) {
        lastNYAmTrueOpen = currentCandleOpenPrice;
        raylines.make(
          bar_index,
          currentCandleOpenPrice,
          undefined,
          undefined,
          'NY am quarter open'
        );
      }

      if (isDayTrueOpen(previousCandleOpenTime, currentCandleOpenTime)) {
        lastDayTrueOpen = currentCandleOpenPrice;
        raylines.make(bar_index, currentCandleOpenPrice, undefined, undefined, 'Day true open');
      }

      if (isNewYorkExchangeOpen(previousCandleOpenTime, currentCandleOpenTime)) {
        lastNYExchangeOpen = currentCandleOpenPrice;
        raylines.make(bar_index, currentCandleOpenPrice, undefined, undefined, 'NY exchange open');
      }
    }

    if (
      isSameDayWithLastCandle(chartData[i].openTime, lastCandle.openTime) &&
      isTimeAfter(chartData[i].openTime, 2, 0) &&
      isTimeBefore(chartData[i].openTime, 5, 0)
    ) {
      if (londonMinimum === null || chartData[i].low < londonMinimum) {
        londonMinimum = chartData[i].low;
        londonMinimumBarIndex = bar_index;
      }

      if (londonMaximum === null || chartData[i].high > londonMaximum) {
        londonMaximum = chartData[i].high;
        londonMaximumBarIndex = bar_index;
      }
    }

    if (
      isTimeAfter(chartData[i].openTime, 5, 0) &&
      londonMinimum !== null &&
      londonMaximum !== null
    ) {
      isLondonHighTaken = isLondonHighTaken || londonMaximum < chartData[i].close;
      isLondonLowTaken = isLondonLowTaken || londonMinimum > chartData[i].close;
    }

    if (
      isYesterdayWithLastCandle(chartData[i].openTime, lastCandle.openTime) &&
      (PDH === null || PDH < chartData[i].high)
    ) {
      PDH = chartData[i].high;
      PDHbarIndex = bar_index;
    }

    if (
      isYesterdayWithLastCandle(chartData[i].openTime, lastCandle.openTime) &&
      (PDL === null || PDL > chartData[i].low)
    ) {
      PDL = chartData[i].low;
      PDLbarIndex = bar_index;
    }

    if (
      isPrevWeek(chartData[i].openTime, new Date(lastCandle.openTime)) &&
      (PWH === null || PWH < chartData[i].high)
    ) {
      PWH = chartData[i].high;
      PWHbarIndex = bar_index;
    }

    if (
      isPrevWeek(chartData[i].openTime, new Date(lastCandle.openTime)) &&
      (PWL === null || PWL > chartData[i].low)
    ) {
      PWL = chartData[i].low;
      PWLbarIndex = bar_index;
    }

    if (
      isPrevMonth(chartData[i].openTime, new Date(lastCandle.openTime)) &&
      (PMH === null || PMH < chartData[i].high)
    ) {
      PMH = chartData[i].high;
      PMHbarIndex = bar_index;
    }

    if (
      isPrevMonth(chartData[i].openTime, new Date(lastCandle.openTime)) &&
      (PML === null || PML > chartData[i].low)
    ) {
      PML = chartData[i].low;
      PMLbarIndex = bar_index;
    }

    /* End of script */
    /* Cached variables should be spread */
    if (i <= chartData.length - 2) {
      open.set(chartData[i + 1].open);
      high.set(chartData[i + 1].high);
      low.set(chartData[i + 1].low);
      close.set(chartData[i + 1].close);
      openTime.set(chartData[i + 1].openTime);
    }

    onIterationEnd$.next(i);
  }

  drawPremiumDiscount(lines, top_x, btm_x, trail_up, trail_dn, chartData);
  drawHighPremiumDiscount(lines, h_top_x, h_btm_x, h_trail_up, h_trail_dn, chartData);

  if (londonMinimum !== null && londonMaximum !== null) {
    raylines.make(
      Number(londonMinimumBarIndex),
      londonMinimum,
      '#33888899',
      PlotLineStyle.SOLID,
      'London minimum',
      LineTitleLocation.RIGHT_TOP
    );
    raylines.make(
      Number(londonMaximumBarIndex),
      londonMaximum,
      '#33888899',
      PlotLineStyle.SOLID,
      'London maximum',
      LineTitleLocation.RIGHT_TOP
    );
  }

  if (PDH) {
    raylines.make(
      Number(PDHbarIndex),
      PDH,
      '#33888899',
      PlotLineStyle.SOLID,
      'Prev Day high',
      LineTitleLocation.RIGHT_TOP
    );
  }

  if (PDL) {
    raylines.make(
      Number(PDLbarIndex),
      PDL,
      '#33888899',
      PlotLineStyle.SOLID,
      'Prev Day low',
      LineTitleLocation.RIGHT_TOP
    );
  }

  if (PWH) {
    raylines.make(
      Number(PWHbarIndex),
      PWH,
      '#33883d99',
      PlotLineStyle.SOLID,
      'Prev Week high',
      LineTitleLocation.RIGHT_TOP
    );
  }

  if (PWL) {
    raylines.make(
      Number(PWLbarIndex),
      PWL,
      '#33883d99',
      PlotLineStyle.SOLID,
      'Prev Week low',
      LineTitleLocation.RIGHT_TOP
    );
  }

  if (PMH) {
    raylines.make(
      Number(PMHbarIndex),
      PMH,
      '#88335299',
      PlotLineStyle.SOLID,
      'Prev Week low',
      LineTitleLocation.RIGHT_TOP
    );
  }

  if (PML) {
    raylines.make(
      Number(PMLbarIndex),
      PML,
      '#88335299',
      PlotLineStyle.SOLID,
      'Prev Week low',
      LineTitleLocation.RIGHT_TOP
    );
  }

  const { price_h_discount } = isYinDiscount.calculate(close.get());

  return {
    renderables: {
      plots: plots.export(),
      plotShapes: plotShapes.export(),
      lines: lines.export(),
      verticalLines: vlines.export(),
      horizontalLines: hlines.export(),
      rayLines: raylines.export(),
      plotRectangles: [
        ...[...fvgCalculator.bearishFvgArray, ...fvgCalculator.bullishFvgArray].map(fvg => convertFvfToRenderable(fvg, chartData.length, '#77777733')),
        ...[...fvgCalculator.bearishIFvgArray, ...fvgCalculator.bullishIFvgArray].map(fvg => convertFvfToRenderable(fvg, chartData.length, '#ff777733')),
      ],
    },
    alerts: alerts,
    insights: {
      trend: trend.get(),
      priceInDiscount: price_h_discount,
      bearishBos: trend.get() === Trend.BULL && itrend.get() === Trend.BEAR,
      bullishBos: trend.get() === Trend.BEAR && itrend.get() === Trend.BULL,
      FVGs: [...fvgCalculator.bearishFvgArray, ...fvgCalculator.bullishFvgArray],
      bearishIFVGs: fvgCalculator.bearishIFvgArray,
      bullishIFVGs: fvgCalculator.bullishIFvgArray,
      lastIFVG: fvgCalculator.getLastIfvg(),
      lastIFVGDirection: fvgCalculator.getLastIfvgDirection(),
      PDH,
      PDL,
      PWH,
      PWL,
      PMH,
      PML,
      aboveNYamTrueOpen: lastNYAmTrueOpen
        ? lastNYAmTrueOpen < chartData[chartData.length - 1].open
        : false,
      aboveNYExchangeOpen: lastNYExchangeOpen
        ? lastNYExchangeOpen < chartData[chartData.length - 1].open
        : false,
      aboveDayTrueOpen: lastDayTrueOpen
        ? lastDayTrueOpen < chartData[chartData.length - 1].open
        : false,
      bullishIfvgOccurs: fvgCalculator.isLastCandleDiscardBearishFvg,
      bearishIfvgOccurs: fvgCalculator.isLastCandleDiscardBullishFvg,
      rangeHigh: h_trail_up.get(),
      rangeLow: h_trail_dn.get(),
      smallRangeReachedRangeHigh: h_trail_up.get() === trail_up.get(),
      smallRangeReachedRangeLow: h_trail_dn.get() === trail_dn.get(),
      isLondonHighTaken,
      isLondonLowTaken,
    },
  };
}
