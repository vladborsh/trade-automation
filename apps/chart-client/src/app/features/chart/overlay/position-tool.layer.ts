import type { ISeriesApi, SeriesType } from 'lightweight-charts';
import { PositionToolController, type PositionToolHost } from './position-tool.controller';
import type { PositionToolsView } from './position-tool.model';
import { PositionToolPrimitive } from './position-tool.primitive';

/**
 * The position tool's two halves behind one small facade, so `ChartComponent` only wires it:
 * `attach` once the chart exists, `render` on every input change, `detach` on destroy.
 */
export class PositionToolLayer {
  private readonly primitive = new PositionToolPrimitive();
  private readonly controller: PositionToolController;

  constructor(private readonly host: PositionToolHost) {
    this.controller = new PositionToolController(host);
  }

  attach(container: HTMLElement, series: ISeriesApi<SeriesType>): void {
    this.primitive.attachTo(series);
    this.controller.attach(container);
    this.render();
  }

  /** Redraws; the caller's effect passes the inputs it read, so it re-runs when they change. */
  render(view: PositionToolsView | null = this.host.view(), enabled: boolean = this.host.enabled()): void {
    this.primitive.setView(enabled && this.host.enabled() ? view : null);
  }

  detach(): void {
    this.controller.detach();
  }
}
