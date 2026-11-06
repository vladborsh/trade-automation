import { afterNextRender, DestroyRef, ElementRef, inject, signal, type Signal } from '@angular/core';

/**
 * IB-089 — the host element's content width as a signal, for charts that lay out in real pixels
 * (so SVG text is never stretched by a viewBox). Call in an injection context.
 *
 * IB-BUG-043 — in a browser the signal is 0 until the host has been MEASURED, and a chart draws
 * nothing while it is 0 (`@if (width())`). It used to start at a 342 px fallback, so the first frame
 * of every chart was 342 px wide until the ResizeObserver tick — wider than a 320 or 390 phone's plot
 * (≈ 324 at 390), and under a frozen clock long enough to widen a mobile layout viewport. A smaller
 * fallback would only swap a too-wide first frame for a too-narrow one on every wider screen.
 * The first measure is taken synchronously in `afterNextRender`: Angular re-runs change detection in
 * the same tick when a render hook writes a signal, so the chart still appears in the first painted
 * frame, at the right width. The ResizeObserver then follows the host. A host that is not laid out
 * (display: none) measures 0 and stays empty until it is.
 *
 * Where there is no ResizeObserver (the unit-test DOM, which has no layout either) the fallback
 * stands, which is what a spec wants anyway.
 */
export function hostWidth(fallback: number): Signal<number> {
  if (typeof ResizeObserver === 'undefined') return signal(fallback).asReadonly();
  const width = signal(0);
  const host = inject(ElementRef<HTMLElement>);
  const destroyRef = inject(DestroyRef);
  afterNextRender(() => {
    const el: HTMLElement = host.nativeElement;
    const w = contentWidth(el);
    if (w > 0) width.set(w);
    const observer = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w > 0) width.set(w);
    });
    observer.observe(el);
    destroyRef.onDestroy(() => observer.disconnect());
  });
  return width.asReadonly();
}

/**
 * The content-box width, as a ResizeObserver's `contentRect.width` reports it, floored. From the
 * fractional border box: `clientWidth` is ROUNDED, so a 324.6 px box would read 325 and draw 0.4 px
 * too wide until the observer corrected it.
 */
function contentWidth(el: HTMLElement): number {
  const s = getComputedStyle(el);
  const edges = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'] as const;
  const inset = edges.reduce((sum, k) => sum + (parseFloat(s[k]) || 0), 0);
  return Math.floor(Math.max(0, el.getBoundingClientRect().width - inset));
}
