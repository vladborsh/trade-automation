import { afterNextRender, DestroyRef, ElementRef, inject, signal, type Signal } from '@angular/core';

/**
 * IB-089 — the host element's content width as a signal, for charts that lay out in real pixels
 * (so SVG text is never stretched by a viewBox). Call in an injection context. Where there is no
 * ResizeObserver (the unit-test DOM) the fallback stands, which is what a spec wants anyway.
 */
export function hostWidth(fallback: number): Signal<number> {
  const width = signal(fallback);
  const host = inject(ElementRef<HTMLElement>);
  const destroyRef = inject(DestroyRef);
  afterNextRender(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w > 0) width.set(w);
    });
    observer.observe(host.nativeElement);
    destroyRef.onDestroy(() => observer.disconnect());
  });
  return width.asReadonly();
}
