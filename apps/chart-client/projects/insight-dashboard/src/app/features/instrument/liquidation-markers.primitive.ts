import type {
  IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, MouseEventParams, SeriesAttachedParameter, Time,
} from 'lightweight-charts';
import { LIQUIDATION_COLORS } from './liquidation-scope';
import type { LiquidationMarker } from './liquidation-markers.adapter';
import { markerUnder, tooltipLines, type PlacedMarker } from './liquidation-tooltip';

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

/** The hover label's look: the app's dark-terminal palette (AGENTS.md). */
const LABEL = { background: '#0d1117', border: '#30363d', text: '#c9d1d9', muted: '#8b949e', fontPx: 11, padPx: 6, lineHeight: 1.35 };

class LiquidationMarkersRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly points: readonly PlacedMarker[],
    private readonly hovered: PlacedMarker | null,
  ) {}

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
      if (this.hovered) drawLabel(ctx, this.hovered, horizontalPixelRatio, verticalPixelRatio);
    });
  }
}

/**
 * IB-068: the hover label, painted beside the bubble on the chart's own canvas. Drawn here rather
 * than as a component so the hover needs no wiring in the chart component: the primitive follows
 * the crosshair itself. Flips to the left of the bubble when it would run off the right edge.
 */
function drawLabel(ctx: CanvasRenderingContext2D, hovered: PlacedMarker, hRatio: number, vRatio: number): void {
  const lines = tooltipLines(hovered.m);
  ctx.save();
  ctx.font = `${LABEL.fontPx * vRatio}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'top';
  const pad = LABEL.padPx * hRatio;
  const lineH = LABEL.fontPx * LABEL.lineHeight * vRatio;
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 2 * pad;
  const height = lines.length * lineH + 2 * pad;
  const gap = (hovered.m.radius + 6) * hRatio;

  let left = hovered.x * hRatio + gap;
  if (left + width > ctx.canvas.width) left = hovered.x * hRatio - gap - width;
  const top = Math.min(Math.max(0, hovered.y * vRatio - height / 2), Math.max(0, ctx.canvas.height - height));

  ctx.fillStyle = LABEL.background;
  ctx.strokeStyle = LABEL.border;
  ctx.lineWidth = Math.max(1, hRatio);
  ctx.fillRect(left, top, width, height);
  ctx.strokeRect(left, top, width, height);
  lines.forEach((line, i) => {
    ctx.fillStyle = i === lines.length - 1 ? LABEL.muted : LABEL.text;
    ctx.fillText(line, left + pad, top + pad + i * lineH);
  });
  ctx.restore();
}

class LiquidationMarkersPaneView implements IPrimitivePaneView {
  constructor(private readonly primitive: LiquidationMarkersPrimitive) {}

  renderer(): IPrimitivePaneRenderer {
    const points = this.primitive.points();
    return new LiquidationMarkersRenderer(points, this.primitive.hoveredIn(points));
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
  /** IB-068: the cursor in the pane's CSS pixels, for the hover label; null off the chart. */
  private cursor: { x: number; y: number } | null = null;
  private readonly onCrosshair = (p: MouseEventParams<Time>) => {
    this.cursor = p.point ? { x: p.point.x, y: p.point.y } : null;
    this.host?.requestUpdate();
  };

  attached(param: SeriesAttachedParameter<Time>): void {
    this.host = param;
    param.chart.subscribeCrosshairMove(this.onCrosshair);
  }

  detached(): void {
    this.host?.chart.unsubscribeCrosshairMove(this.onCrosshair);
    this.host = null;
    this.cursor = null;
  }

  /** The bubble under the cursor among `points`, or null. */
  hoveredIn(points: readonly PlacedMarker[]): PlacedMarker | null {
    return this.cursor ? markerUnder(points, this.cursor.x, this.cursor.y) : null;
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
  points(): readonly PlacedMarker[] {
    const param = this.host;
    if (!param) return [];
    const timeScale = param.chart.timeScale();
    const series = param.series;

    const out: PlacedMarker[] = [];
    for (const m of this.markers) {
      const x = timeScale.timeToCoordinate(m.time as unknown as Time);
      const y = series.priceToCoordinate(m.price);
      if (x === null || y === null) continue;
      out.push({ x, y, m });
    }
    return out;
  }
}
