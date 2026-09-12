import { OrderDirection } from "../../strategy/enum/order-direction.enum";
import { Nullable } from "../../types/types";
import { PremDisc, Trend } from "../enums";
import { FVG } from "../interfaces/fvg";
import { HorizontalPlotLine } from "../interfaces/horizontal-plot-line";
import { Plot } from "../interfaces/plot";
import { PlotLine } from "../interfaces/plot-line";
import { PlotRectangle } from "../interfaces/plot-rectangle";
import { PlotShape } from "../interfaces/plot-shape";
import { RayLine } from "../interfaces/ray-line";
import { VerticalPlotLine } from "../interfaces/vertial-plot-line";

export interface SmIndicatorResponse {
  errors?: string[];
  data: Partial<SmartMoneyIndicatorData>;
}

export interface ChartRenderableEntities {
  plots: Plot[];
  plotShapes: PlotShape[];
  lines: PlotLine[];
  verticalLines: VerticalPlotLine[];
  horizontalLines: HorizontalPlotLine[];
  rayLines: RayLine[];
  plotRectangles: PlotRectangle[];
}

export interface SmartMoneyIndicatorData {
  alerts: string[];
  renderables: ChartRenderableEntities;
  insights: SmIndicatorInsights;
}

export interface SmIndicatorInsights {
  trend: Trend,
  priceInDiscount: boolean,
  bearishBos: boolean,
  bullishBos: boolean,
  FVGs: FVG[];
  lastIFVG?: FVG;
  bullishIFVGs: FVG[];
  bearishIFVGs: FVG[];
  lastIFVGDirection: OrderDirection;
  PDH: Nullable<number>;
  PDL: Nullable<number>;
  PWH: Nullable<number>;
  PWL: Nullable<number>;
  PMH: Nullable<number>;
  PML: Nullable<number>;
  aboveNYamTrueOpen: boolean;
  aboveNYExchangeOpen: boolean;
  aboveDayTrueOpen: boolean;
  bullishIfvgOccurs: boolean;
  bearishIfvgOccurs: boolean;
  rangeHigh: number;
  rangeLow: number;
  smallRangeReachedRangeHigh: boolean;
  smallRangeReachedRangeLow: boolean;
  isLondonHighTaken: boolean;
  isLondonLowTaken: boolean;
}

