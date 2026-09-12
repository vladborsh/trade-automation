import { PlotShape, ShapeLocation } from '../interfaces/plot-shape';

export class PlotShapesBuilder {
  plotshapes: Record<string, PlotShape> = {};

  make(title: string, color: string, location: ShapeLocation): void {
    this.plotshapes[title] = { values: [], color, title, location };
  }

  set(key: string, value: boolean) {
    if (!this.plotshapes[key]) {
      this.plotshapes[key] = { values: [], color: '#ee3333', title: key, location: ShapeLocation.BELOW };
    }
    this.plotshapes[key].values.push(value);
  }

  export(): PlotShape[] {
    return Object.values(this.plotshapes);
  }
}
