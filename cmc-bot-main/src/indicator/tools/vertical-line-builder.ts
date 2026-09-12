import { PlotLineStyle } from '../interfaces/plot-line';
import { VLineTitleLocation, VerticalPlotLine } from '../interfaces/vertial-plot-line';

export class VerticalLineBuilder {
  private array: VerticalPlotLine[] = [];

  make(
    x: number,
    style?: PlotLineStyle,
    color?: string,
    title?: string,
    titleLocation?: VLineTitleLocation
  ): void {
    this.array.push({ x, style, color, title, titleLocation });
  }

  export(): VerticalPlotLine[] {
    return this.array;
  }
}
