import type { ChartOptions, DeepPartial, IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import { applyDrag, draggableParts, hitTest, toolGeometry, type HitTarget } from './position-tool.geometry';
import type { PositionToolChange, PositionToolState, PositionToolsView } from './position-tool.model';
import { anchorVisible, anchorX } from './position-tool.primitive';

/** What the controller reads from its chart, at call time. */
export interface PositionToolHost {
  chart(): IChartApi | null;
  series(): ISeriesApi<SeriesType> | null;
  view(): PositionToolsView | null;
  enabled(): boolean;
  lastClose(): number | null;
  emit(change: PositionToolChange): void;
}

/** Within this many px of the last close, a dragged entry snaps to it (market). */
const MARKET_SNAP_PX = 4;
export const HIT_TOLERANCE_PX = 6;

interface Drag {
  pointerId: number;
  target: HitTarget;
  original: PositionToolState;
  grabPrice: number;
  latest: PositionToolState;
  saved: { handleScroll: ChartOptions['handleScroll']; handleScale: ChartOptions['handleScale'] };
}

/**
 * backtest-app-system-design.md §9.1 — the pointer layer lightweight-charts does not give a
 * primitive. Listens on the chart's container (capture phase, so it runs before the chart's own
 * handlers):
 * - pointerdown: hit-test every tool (6 px). A hit activates that tool (decision 29, "last
 *   clicked") and, on a draggable part, starts a drag: the chart's scroll and scale are switched
 *   off and the pointer is captured. A miss does nothing, so the chart pans as usual.
 * - pointermove without a drag: hover feedback — a resize cursor over a stop/target or handle, a
 *   move cursor over a draft's entry line (mirrored in `data-position-tool-hover` for e2e);
 * - pointermove while dragging: the grabbed part follows the pointer through `applyDrag` (prices
 *   snapped to `pricePrecision`, the market/limit flip at the last close, stop-entries refused
 *   with a hint), emitted as a non-final update.
 * - pointerup / pointercancel: scroll and scale are restored to what they were, capture is
 *   released, and the last state is emitted as final.
 */
export class PositionToolController {
  private el: HTMLElement | null = null;
  private drag: Drag | null = null;
  private hovered: string | null = null;
  private readonly onDown = (e: PointerEvent) => this.pointerDown(e);
  private readonly onMove = (e: PointerEvent) => this.pointerMove(e);
  private readonly onUp = (e: PointerEvent) => this.pointerEnd(e);

  constructor(private readonly host: PositionToolHost) {}

  attach(el: HTMLElement): void {
    this.detach();
    this.el = el;
    el.addEventListener('pointerdown', this.onDown, true);
    el.addEventListener('pointermove', this.onMove, true);
    el.addEventListener('pointerup', this.onUp, true);
    el.addEventListener('pointercancel', this.onUp, true);
  }

  detach(): void {
    if (!this.el) return;
    this.el.removeEventListener('pointerdown', this.onDown, true);
    this.el.removeEventListener('pointermove', this.onMove, true);
    this.el.removeEventListener('pointerup', this.onUp, true);
    this.el.removeEventListener('pointercancel', this.onUp, true);
    this.el = null;
    this.drag = null;
  }

  /** True while a drag is in progress (for specs). */
  get dragging(): boolean {
    return this.drag !== null;
  }

  /** What the pointer is over, or null (disabled, no tools, a miss). */
  private hit(e: PointerEvent): { target: HitTarget; tool: PositionToolState; y: number } | null {
    const chart = this.host.chart();
    const series = this.host.series();
    const view = this.host.view();
    if (!this.el || !chart || !series || !view || !this.host.enabled()) return null;
    const { x, y } = this.local(e);
    const priceToY = (p: number) => series.priceToCoordinate(p);
    const width = chart.timeScale().width();
    const geometries = view.tools
      .map((t) => {
        const x = anchorX(chart, t.anchorTime);
        return anchorVisible(x, width) ? toolGeometry(t, x, priceToY, width) : null; // off-screen right: not hittable
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
    const target = hitTest(x, y, geometries, new Map(view.tools.map((t) => [t.id, t.kind])), HIT_TOLERANCE_PX);
    return target ? { target, tool: view.tools.find((t) => t.id === target.toolId)!, y } : null;
  }

  private pointerDown(e: PointerEvent): void {
    const chart = this.host.chart();
    const series = this.host.series();
    if (this.drag || !chart || !series) return;
    const hit = this.hit(e);
    if (!hit) return; // a miss: the chart pans as usual
    const { target, tool, y } = hit;
    e.stopPropagation();
    e.preventDefault();
    this.host.emit({ type: 'activate', id: tool.id });
    const grabPrice = series.coordinateToPrice(y);
    if (!draggableParts(tool).includes(target.part) || grabPrice === null) return;

    // a deep copy: `options()` is the chart's live object, which `applyOptions` below merges into
    const options = structuredClone({ handleScroll: chart.options().handleScroll, handleScale: chart.options().handleScale });
    this.drag = {
      pointerId: e.pointerId,
      target,
      original: tool,
      grabPrice,
      latest: tool,
      saved: { handleScroll: options.handleScroll, handleScale: options.handleScale },
    };
    chart.applyOptions({ handleScroll: false, handleScale: false });
    this.el?.setPointerCapture(e.pointerId);
  }

  private pointerMove(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return this.hover(e);
    const series = this.host.series();
    const view = this.host.view();
    if (e.pointerId !== drag.pointerId || !series || !view) return;
    e.stopPropagation();
    const { y } = this.local(e);
    const price = series.coordinateToPrice(y);
    const lastClose = this.host.lastClose();
    if (price === null || lastClose === null) return;
    const snapTop = series.coordinateToPrice(y - MARKET_SNAP_PX);
    const marketSnap = snapTop === null ? 0 : Math.abs(snapTop - price);
    const result = applyDrag({
      original: drag.original,
      part: drag.target.part,
      price,
      grabPrice: drag.grabPrice,
      lastClose,
      precision: view.pricePrecision,
      marketSnap,
    });
    if ('hint' in result) {
      this.host.emit({ type: 'hint', message: result.hint });
      return;
    }
    drag.latest = result.tool;
    this.host.emit({ type: 'update', tool: result.tool, final: false });
  }

  private pointerEnd(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    this.drag = null;
    this.host.chart()?.applyOptions(drag.saved as DeepPartial<ChartOptions>);
    if (this.el?.hasPointerCapture?.(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    this.host.emit({ type: 'update', tool: drag.latest, final: true });
  }

  /** Touches the DOM only when the hover state changes (never on a chart without tools). */
  private hover(e: PointerEvent): void {
    if (!this.el) return;
    const hit = this.hit(e);
    const grabbable = hit && draggableParts(hit.tool).includes(hit.target.part) ? hit.target : null;
    const state = grabbable ? `${grabbable.kind}:${grabbable.part}:${grabbable.toolId}` : null;
    if (state === this.hovered) return;
    this.hovered = state;
    this.el.style.cursor = grabbable ? (grabbable.part === 'body' ? 'move' : 'ns-resize') : '';
    if (state) this.el.dataset['positionToolHover'] = state;
    else delete this.el.dataset['positionToolHover'];
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const rect = this.el!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
}
