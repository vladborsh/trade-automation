export interface PlotShape {
  values: boolean[];
  color?: string;
  title?: string;
  location?: ShapeLocation;
}

export enum ShapeLocation {
  ABOVE = 'ABOVE',
  BELOW = 'BELOW',
}
