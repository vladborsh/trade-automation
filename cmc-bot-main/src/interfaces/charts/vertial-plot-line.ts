import { PlotLineStyle } from "./plot-line";

export interface VerticalPlotLine {
  x: number;
  style?: PlotLineStyle;
  color?: string;
  title?: string;
  titleLocation?: VLineTitleLocation;
}

export enum VLineTitleLocation {
  TOP = 'TOP',
  BOTTOM = 'BOTTOM',
}
