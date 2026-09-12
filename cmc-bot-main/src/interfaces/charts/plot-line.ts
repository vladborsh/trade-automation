export interface PlotLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
  style?: PlotLineStyle;
  title?: string;
  titleLocation?: LineTitleLocation;
}

export enum PlotLineStyle{
  SOLID = 'SOLID',
  DASHED = 'DASHED',
  DOTTED = 'DOTTED',
}

export enum LineTitleLocation {
  LEFT_TOP = 'LEFT_TOP',
  LEFT_BOTTOM = 'LEFT_BOTTOM',
  RIGHT_TOP = 'RIGHT_TOP',
  RIGHT_BOTTOM = 'RIGHT_BOTTOM',
}

