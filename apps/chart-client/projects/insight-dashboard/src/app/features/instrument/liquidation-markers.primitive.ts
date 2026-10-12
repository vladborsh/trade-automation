import type {
  IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time,
} from 'lightweight-charts';
import { LIQUIDATION_COLORS } from './liquidation-scope';
import type { LiquidationMarker } from './liquidation-markers.adapter';

/**
 * IB-039 — the liquidation bubbles drawn over the price series (design §12.5).
 *
 * A lightweight-charts **series primitive** rather than the library's built-in markers: those
 * are fixed glyphs anchored above or below a bar, and §12.5 needs a circle at an arbitrary
 * (time, price) whose radius carries the size. All the arithmetic that decides what a bubble
 * means lives in `liquidation-markers.adapter.ts` with its spec; this file only converts
 * already-decided values into coordinates and paints them.
 *
 * Colour follows IB-031's rule, kept across every liquidation surface: longs in the DOWN colour
 * and shorts in the UP colour, because a long being liquidated is price falling — the colour
 * matches what the market did, not the noun.
 */

/** Stroked, not filled solid: a filled bubble hides the candle it is about. */
const FILL_ALPHA = 0.22;

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

class LiquidationMarkersRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly points: ReadonlyArray<{ x: number; y: number; m: LiquidationMarker }>) {}

  draw(target: {
    useBitmapCoordinateSpace: (cb: (scope: {
      context: CanvasRenderingContext2D; horizontalPixelRatio: number; verticalPixelRatio: number;
    }) => void) => void;
  }): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio, verticalPixelRatio }) => {
      for (const { x, y, m } of this.points) {
        const colour = m.side === 'long' ? LIQUIDATION_COLORS.long : LIQUIDATION_COLORS.short;
        const px = x * horizontalPixelRatio;
        const py = y * verticalPixelRatio;
        const r = m.radius * horizontalPixelRatio;

        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(colour, FILL_ALPHA);
        ctx.fill();
        ctx.lineWidth = Math.max(1, horizontalPixelRatio);
        ctx.strokeStyle = colour;
        ctx.stroke();

        // A clamped bubble is at the top of the scale and understates its own size, so it gets a
        // second ring: without it a $12M and a $400M cascade are the same circle (adapter spec).
        if (m.clamped) {
          ctx.beginPath();
          ctx.arc(px, py, r + 3 * horizontalPixelRatio, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    });
  }
}

class LiquidationMarkersPaneView implements IPrimitivePaneView {
  constructor(private readonly primitive: LiquidationMarkersPrimitive) {}

  renderer(): IPrimitivePaneRenderer {
    return new LiquidationMarkersRenderer(this.primitive.points());
  }
}

/**
 * Attach with `priceSeries.attachPrimitive(new LiquidationMarkersPrimitive())`, then feed it
 * markers with `setMarkers`. It keeps no copy of the chart's data and derives every coordinate
 * on each paint, so panning and zooming need no bookkeeping here.
 */
export class LiquidationMarkersPrimitive implements ISeriesPrimitive<Time> {
  private markers: readonly LiquidationMarker[] = [];
  /** Named `host`, not `attached`: `attached()` is the interface's lifecycle hook. */
  private host: SeriesAttachedParameter<Time> | null = null;
  private readonly views = [new LiquidationMarkersPaneView(this)];

  attached(param: SeriesAttachedParameter<Time>): void {
    this.host = param;
  }

  detached(): void {
    this.host = null;
  }

  setMarkers(markers: readonly LiquidationMarker[]): void {
    this.markers = markers;
    this.host?.requestUpdate();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  /**
   * Markers converted to pixels, with anything off-screen dropped.
   *
   * `timeToCoordinate` returns null for a time outside the visible range, and `priceToCoordinate`
   * for a price outside the scale — both are normal while panning, so they are filtered rather
   * than defaulted to 0, which would pile every off-screen bubble in the top-left corner.
   */
  points(): ReadonlyArray<{ x: number; y: number; m: LiquidationMarker }> {
    const param = this.host;
    if (!param) return [];
    const timeScale = param.chart.timeScale();
    const series = param.series;

    const out: Array<{ x: number; y: number; m: LiquidationMarker }> = [];
    for (const m of this.markers) {
      const x = timeScale.timeToCoordinate(m.time as unknown as Time);
      const y = series.priceToCoordinate(m.price);
      if (x === null || y === null) continue;
      out.push({ x, y, m });
    }
    return out;
  }
}
