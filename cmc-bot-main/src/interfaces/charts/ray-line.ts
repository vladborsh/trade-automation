import { LineTitleLocation, PlotLineStyle } from "./plot-line";

export interface RayLine {
  x: number;
  y: number;
  color?: string;
  style?: PlotLineStyle;
  title?: string;
  titleLocation?: LineTitleLocation;
}


