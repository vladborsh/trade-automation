import type {
  IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, MouseEventParams, SeriesAttachedParameter, SeriesType, Time,
} from 'lightweight-charts';
import { bandOf } from '@trade-automation/contracts';
import { LIQUIDATION_COLORS } from './liquidation-scope';
import { bandDetail, placeBands, stripWidth, type PlacedBand } from './liq-profile-geometry';
import { profileWindow } from './liq-profile-view';
import type { LiqProfileStore } from './liq-profile.store';
import type { PaneData } from './pane-data';
import { barSeconds } from './time-grid';

/**
 * IB-153 — the liquidation profile at the price pane's right edge, ON the pane's price scale.
 *
 * A series primitive on the candles, like the liquidation bubbles (`liquidation-markers.primitive.ts`):
 * every band edge goes through the series' own `priceToCoordinate` on each paint, so a band at price P sits
 * at P on the axis by construction, and vertical zoom, scroll and autoscale need no event (the library has
 * none for the price scale). The same paint reports the view (visible bars, price span) to the store, which
 * decides whether that needs a read (`liq-profile-view.ts`).
 *
 * Translucent, over the last candles, as a volume profile is; the chart's `rightOffset` is left alone.
 * Below `PROFILE_STRIP_MIN_PANE_PX` (a phone) nothing is drawn — the histogram under the chart takes over —
 * but the view is still reported, because that histogram reads the same answer.
 */

const BACKDROP = 'rgba(13, 17, 23, 0.55)'; // #0d1117, the page background
const EDGE = '#30363d';
const MARK = '#c9d1d9';
const BAR_ALPHA = 0.7;

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

interface Scene {
  left: number;
  width: number;
  bands: readonly PlacedBand[];
  priceY: number | null;
  hovered: number | null;
}

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

class ProfileRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly scene: Scene) {}

  draw(target: DrawTarget): void {
    const { left, width, bands, priceY, hovered } = this.scene;
    if (width === 0) return;
    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const x0 = Math.round(left * hr);
      const centre = Math.round((left + width / 2) * hr);
      ctx.fillStyle = BACKDROP;
      ctx.fillRect(x0, 0, Math.round(width * hr), bitmapSize.height);
      ctx.fillStyle = EDGE;
      ctx.fillRect(x0, 0, Math.max(1, Math.round(hr)), bitmapSize.height);
      ctx.fillRect(centre, 0, Math.max(1, Math.round(hr)), bitmapSize.height);
      for (const b of bands) {
        const top = Math.round(b.yTop * vr);
        // a 1 px gap between bands, so neighbours read as separate prices
        const h = Math.max(1, Math.round(b.yBottom * vr) - top - Math.round(vr));
        ctx.fillStyle = withAlpha(LIQUIDATION_COLORS.long, b.band === hovered ? 1 : BAR_ALPHA);
        ctx.fillRect(centre - Math.round(b.longPx * hr), top, Math.round(b.longPx * hr), h);
        ctx.fillStyle = withAlpha(LIQUIDATION_COLORS.short, b.band === hovered ? 1 : BAR_ALPHA);
        ctx.fillRect(centre + Math.max(1, Math.round(hr)), top, Math.round(b.shortPx * hr), h);
      }
      if (priceY !== null) {
        // the current price: a short tick across the centre line
        const y = Math.round(priceY * vr);
        ctx.fillStyle = MARK;
        ctx.fillRect(centre - Math.round(8 * hr), y, Math.round(17 * hr), Math.max(1, Math.round(vr)));
      }
    });
  }
}

class ProfilePaneView implements IPrimitivePaneView {
  constructor(private readonly primitive: LiqProfilePrimitive) {}
  renderer(): IPrimitivePaneRenderer {
    return new ProfileRenderer(this.primitive.scene());
  }
}

export class LiqProfilePrimitive implements ISeriesPrimitive<Time> {
  private host: SeriesAttachedParameter<Time> | null = null;
  private unlisten: (() => void) | null = null;
  private readonly views = [new ProfilePaneView(this)];
  private hovered: number | null = null;
  private readonly onCrosshair = (p: MouseEventParams<Time>) => this.hoverAt(p.point ?? null);

  constructor(
    private readonly store: LiqProfileStore,
    private readonly symbol: string,
    private readonly barSec: number,
    lastClose: number | null,
  ) {
    store.lastPrice.set(lastClose);
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.host = param;
    param.chart.subscribeCrosshairMove(this.onCrosshair);
    this.unlisten = this.store.listen(() => param.requestUpdate());
  }

  detached(): void {
    this.host?.chart.unsubscribeCrosshairMove(this.onCrosshair);
    this.unlisten?.();
    this.unlisten = null;
    this.host = null;
    if (this.hovered !== null) this.store.hover.set(null);
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  /** Every repaint: report the view; the store ignores one it already has. */
  updateAllViews(): void {
    const host = this.host;
    if (!host) return;
    // the CANDLES' bars in view: the time scale also holds sparse points left of them (the level lines'
    // daily times), so the scale's own visible range can start days before the first candle on screen
    const logical = host.chart.timeScale().getVisibleLogicalRange();
    const bars = logical ? host.series.barsInLogicalRange(logical) : null;
    const height = this.paneSize().height;
    const hi = host.series.coordinateToPrice(0);
    const lo = host.series.coordinateToPrice(height);
    if (!bars || bars.from === undefined || bars.to === undefined || hi === null || lo === null || height <= 0) return;
    const window = profileWindow(bars.from as number, bars.to as number, this.barSec, Date.now());
    if (!window || !(lo > 0) || !(hi > lo)) return;
    this.store.setView({ symbol: this.symbol, ...window, lo, hi });
  }

  scene(): Scene {
    const host = this.host;
    const answer = this.store.answer();
    const paneWidth = this.paneSize().width;
    const width = stripWidth(paneWidth);
    if (!host || !answer || answer.symbol !== this.symbol || width === 0) return { left: 0, width: 0, bands: [], priceY: null, hovered: null };
    const series = host.series as ISeriesApi<SeriesType>;
    const last = this.store.lastPrice();
    return {
      left: paneWidth - width,
      width,
      bands: placeBands(answer, (p) => series.priceToCoordinate(p), this.paneSize().height, width / 2),
      priceY: last === null ? null : series.priceToCoordinate(last),
      hovered: this.hovered,
    };
  }

  /**
   * The price pane's size. Not `timeScale().width()`: this chart hides its own time axis (the sticky strip
   * draws it), and a hidden axis reports a width of 0.
   */
  private paneSize(): { width: number; height: number } {
    return this.host?.chart.paneSize(0) ?? { width: 0, height: 0 };
  }

  /** The band under the pointer when it is over the strip; the tooltip reads it from the store. */
  private hoverAt(point: { x: number; y: number } | null): void {
    const host = this.host;
    const answer = this.store.answer();
    const { width: paneWidth, height } = this.paneSize();
    const width = stripWidth(paneWidth);
    const price = host && point && width > 0 && point.x >= paneWidth - width && point.y <= height
      ? host.series.coordinateToPrice(point.y) : null;
    const band = answer && price !== null ? bandOf(price, answer.step) : null;
    if (band === this.hovered) return;
    this.hovered = band;
    this.store.hover.set(band === null || !answer || !point ? null : { detail: bandDetail(answer, band), x: point.x, y: point.y });
    host?.requestUpdate();
  }
}

/**
 * Puts a fresh strip on the candles of a chart just drawn or redrawn (a redraw in place makes new series, and
 * the old strip goes with the old candles); the store carries the answer across. No store, no strip.
 */
export function attachProfile(price: ISeriesApi<SeriesType> | null, store: LiqProfileStore | null, symbol: string, data: PaneData): void {
  if (!price || !store) return;
  const candles = data.candles.candles;
  const lastClose = candles.length > 0 ? candles[candles.length - 1]!.close : null;
  price.attachPrimitive(new LiqProfilePrimitive(store, symbol, barSeconds(data.timeframe), lastClose) as never);
}
