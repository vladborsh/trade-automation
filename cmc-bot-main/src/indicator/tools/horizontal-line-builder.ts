import { HLineTitleLocation, HorizontalPlotLine } from '../interfaces/horizontal-plot-line';
import { PlotLineStyle } from '../interfaces/plot-line';
import { VLineTitleLocation, VerticalPlotLine } from '../interfaces/vertial-plot-line';

export class HorizontalLineBuilder {
  private array: HorizontalPlotLine[] = [];

  make(
    y: number,
    style?: PlotLineStyle,
    color?: string,
    title?: string,
    titleLocation?: HLineTitleLocation
  ): void {
    this.array.push({ y, style, color, title, titleLocation });
  }

  export(): HorizontalPlotLine[] {
    return this.array;
  }
}
