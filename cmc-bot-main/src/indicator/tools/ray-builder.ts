import { LineTitleLocation, PlotLineStyle } from '../interfaces/plot-line';
import { RayLine } from '../interfaces/ray-line';

export class RayLineBuilder {
  private array: RayLine[] = [];

  make(
    x: number,
    y: number,
    color?: string,
    style?: PlotLineStyle,
    title?: string,
    titleLocation?: LineTitleLocation,
  ): RayLine {
    const line = { x, y, style, color, title, titleLocation };
    this.array.push(line);
    return line;
  }

  delete(toBeRemoved: RayLine): void {
    this.array = this.array.filter(line => line !== toBeRemoved);
  }

  export(): RayLine[] {
    return this.array;
  }
}
