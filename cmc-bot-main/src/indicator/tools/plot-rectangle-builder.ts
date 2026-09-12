import { PlotRectangle } from '../interfaces/plot-rectangle';

export class PlotRectangleBuilder {
  private array: PlotRectangle[] = [];

  make(left: number, right: number, top: number, bottom: number, color?: string) {
    this.array.push({ left, right, top, bottom, color });
  }

  export(): PlotRectangle[] {
    return this.array;
  }
}
