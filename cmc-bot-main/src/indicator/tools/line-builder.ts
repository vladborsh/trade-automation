import { LineTitleLocation, PlotLine, PlotLineStyle } from '../interfaces/plot-line';

export class LineBuilder {
  private array: PlotLine[] = [];

  make(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color?: string,
    style?: PlotLineStyle,
    title?: string,
    titleLocation?: LineTitleLocation,
  ): PlotLine {
    const line = { x1, y1, x2, y2, style, color, title, titleLocation };
    this.array.push(line);
    return line;
  }

  delete(toBeRemoved: PlotLine): void {
    this.array = this.array.filter(line => line !== toBeRemoved);
  }

  export(): PlotLine[] {
    return this.array;
  }
}
