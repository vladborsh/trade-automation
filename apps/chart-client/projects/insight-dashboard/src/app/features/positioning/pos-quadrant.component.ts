import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import type { WebMarketPeriod, WebPositioningRow } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import { hostWidth } from '../../ui/host-width';
import { formatUsd } from '../liquidations/liquidations.format';
import { signedPct } from '../market/shell/market-text';
import { quadrantLayout, quadrantLink, QUADRANT_PAD } from './pos-layout';
import { bulkDomain, dataAt, type Domain, fullDomain, panByPx, sameDomain, zoom, ZOOM_STEP } from './pos-zoom';
import { QuadrantGestures } from './quadrant-gestures';

/** IB-137: the two named views, or wherever zoom and pan left it. */
export type QuadrantView = { mode: 'bulk' } | { mode: 'full' } | { mode: 'custom'; domain: Domain };

/**
 * IB-090 (D9) — price × OI: one dot per coin, area ∝ OI in USD, the four quadrants named in their
 * corners; labels that would overlap are dropped by the layout, never drawn on top of each other.
 *
 * IB-137 (market round 3 §2): the view is a data domain — «без выбросов» by default, coins outside it
 * pinned to the edge — with + / − / wheel / pinch zoom and pan (`pos-zoom.ts`, `quadrant-gestures.ts`).
 * A pointer device hovers a dot for its numbers and clicks to open the coin; on touch the first tap
 * shows the numbers with «Открыть →» and a tap elsewhere closes them. Dots take keyboard focus in OI
 * order (focus shows the numbers, Enter opens). The view is a momentary look: not in the URL.
 */
@Component({
  selector: 'app-pos-quadrant',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './pos-quadrant.component.html',
  styleUrl: './pos-quadrant.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocumentClick($event)' },
})
export class PosQuadrantComponent {
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly rows = input.required<readonly WebPositioningRow[]>();
  /** IB-137: the answer's `asOf` and period, for R4's link (the period's start). */
  readonly asOf = input.required<number>();
  readonly period = input.required<WebMarketPeriod>();
  readonly width = hostWidth(342);
  /** IB-103: the Market block caps it at 360 px; the positioning page lets it grow. */
  readonly maxHeight = input(360);
  /** D16: the quadrant keeps its aspect ratio on a phone (4:3, capped). */
  readonly height = computed(() => Math.round(Math.min(this.maxHeight(), this.width() * 0.75)));
  private readonly size = computed(() => ({ width: this.width(), height: this.height() }));

  readonly view = signal<QuadrantView>({ mode: 'bulk' });
  readonly full = computed(() => fullDomain(this.rows()));
  readonly domain = computed(() => {
    const v = this.view();
    return v.mode === 'bulk' ? bulkDomain(this.rows()) : v.mode === 'full' ? this.full() : v.domain;
  });
  /** One finger and a mouse drag pan only here; elsewhere a swipe scrolls the page. */
  readonly pannable = computed(() => this.view().mode === 'custom');
  readonly layout = computed(() => quadrantLayout(this.rows(), this.size(), this.domain()));
  readonly pad = QUADRANT_PAD;

  /** `(hover: hover)`, not width: a pointer device hovers and clicks, a finger taps twice. */
  readonly hover = inject(DOCUMENT).defaultView?.matchMedia?.('(hover: hover)').matches ?? false;
  /** The coin whose numbers are shown. */
  readonly active = signal<string | null>(null);
  readonly tip = computed(() => {
    const d = this.layout().dots.find((x) => x.row.symbol === this.active());
    if (!d) return null;
    const row = d.row;
    const text = this.t('positioning.quadrant.detail', {
      coin: row.base,
      price: signedPct(row.priceChangePct.value) ?? '—',
      oi: signedPct(row.oiChangePct.value) ?? '—',
      oiUsd: row.oiUsd === null ? '—' : formatUsd(row.oiUsd),
    });
    return { text, x: d.cx, y: d.cy, flipX: d.cx > this.width() / 2, above: d.cy > this.height() / 2, link: this.link(row.symbol) };
  });

  private readonly plot = viewChild.required<ElementRef<HTMLElement>>('plot');

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const g = new QuadrantGestures(this.plot().nativeElement, {
        zoomAt: (f, px, py) => this.zoomAt(f, px, py),
        panBy: (dx, dy) => this.view.set({ mode: 'custom', domain: panByPx(this.domain(), this.size(), dx, dy, this.full()) }),
        pannable: () => this.pannable(),
      });
      destroyRef.onDestroy(() => g.destroy());
    });
  }

  setView(mode: 'bulk' | 'full'): void {
    this.view.set({ mode });
  }

  /** + and −: about the centre of the plot. */
  zoomBy(factor: number): void {
    this.zoomAt(factor, this.width() / 2, this.height() / 2);
  }

  readonly zoomIn = 1 / ZOOM_STEP;
  readonly zoomOut = ZOOM_STEP;

  zoomAt(factor: number, px: number, py: number): boolean {
    const d = this.domain();
    const next = zoom(d, factor, dataAt(d, this.size(), px, py), this.full());
    if (sameDomain(next, d)) return false;
    this.view.set(sameDomain(next, this.full()) ? { mode: 'full' } : { mode: 'custom', domain: next });
    return true;
  }

  link(symbol: string) {
    return quadrantLink(symbol, this.asOf(), this.period());
  }

  open(symbol: string): void {
    const l = this.link(symbol);
    void this.router.navigate(l.commands, { queryParams: l.queryParams });
  }

  /** One handler for the whole chart: a dot's click opens it (pointer) or shows it first (touch). */
  onChartClick(e: Event): void {
    const symbol = (e.target as Element | null)?.closest?.('[data-symbol]')?.getAttribute('data-symbol') ?? null;
    if (symbol === null) this.active.set(null);
    else if (this.hover || this.active() === symbol) this.open(symbol);
    else this.active.set(symbol);
  }

  onDocumentClick(e: Event): void {
    if (!this.host.nativeElement.contains(e.target as Node)) this.active.set(null);
  }

  onHover(symbol: string | null): void {
    if (this.hover) this.active.set(symbol);
  }

  /** Keyboard focus only: a tap also focuses the dot, and must not count as the first of two taps. */
  onFocus(e: FocusEvent, symbol: string): void {
    if ((e.target as Element).matches?.(':focus-visible')) this.active.set(symbol);
  }

  onBlur(symbol: string): void {
    if (this.active() === symbol) this.active.set(null);
  }

}
