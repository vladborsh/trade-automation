import { PlotLineStyle } from './plot-line';

export interface HorizontalPlotLine {
  y: number;
  style?: PlotLineStyle;
  color?: string;
  title?: string;
  titleLocation?: HLineTitleLocation;
}

export enum HLineTitleLocation {
  LEFT = 'LEFT',
  RIGHT = 'RIGHT',
}
