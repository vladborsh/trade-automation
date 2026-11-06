import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostWidth } from './host-width';

/**
 * IB-BUG-043 — a chart is drawn only once its host has been measured, and its FIRST drawing is at the
 * measured width: never at the fallback, then corrected. The unit DOM has no ResizeObserver and no
 * layout, so the browser path is exercised with a stub observer and a stubbed host box; without them
 * the fallback stands (what every chart spec relies on).
 */
@Component({
  selector: 'app-host-width-probe',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (width()) { <svg class="chart" [attr.width]="width()"></svg> }`,
})
class ProbeComponent {
  readonly width = hostWidth(342);
}

class FakeResizeObserver {
  static last: FakeResizeObserver | null = null;
  observed: Element[] = [];
  disconnected = false;
  constructor(readonly cb: ResizeObserverCallback) { FakeResizeObserver.last = this; }
  observe(el: Element) { this.observed.push(el); }
  unobserve() { /* unused */ }
  disconnect() { this.disconnected = true; }
  fire(width: number) { this.cb([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
}

/** Mount with the host's border box `boxWidth` px wide; every svg width attribute change is recorded. */
function mount(boxWidth: number, padding = 0) {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  TestBed.configureTestingModule({ imports: [ProbeComponent] });
  const f = TestBed.createComponent(ProbeComponent);
  const el = f.nativeElement as HTMLElement;
  el.style.paddingLeft = `${padding}px`;
  el.style.paddingRight = `${padding}px`;
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ width: boxWidth } as DOMRect);
  const mutations = new MutationObserver(() => undefined);
  mutations.observe(el, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['width'] });
  const svg = () => el.querySelector('svg.chart');
  /** Every width the svg was given BEFORE its current one (a redraw), and how many svgs were inserted. */
  const history = () => {
    const recs = mutations.takeRecords();
    return {
      redrawnFrom: recs.filter((r) => r.type === 'attributes' && r.oldValue !== null).map((r) => r.oldValue),
      inserted: recs.flatMap((r) => [...r.addedNodes]).filter((n) => n.nodeName.toLowerCase() === 'svg').length,
    };
  };
  return { f, el, svg, history };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeResizeObserver.last = null;
});

describe('hostWidth (IB-BUG-043)', () => {
  it('first drawing is at the measured width — 324.6 px box → 324 — and never at the 342 fallback', () => {
    const { f, svg, history } = mount(324.6);
    f.detectChanges();
    expect(svg()?.getAttribute('width')).toBe('324');
    const h = history();
    expect(h.inserted).toBe(1);
    expect(h.redrawnFrom).toEqual([]); // not created at 342 (or anything) and then corrected
  });

  it('measures the content box, as ResizeObserver does: padding is not chart width', () => {
    const { f, svg } = mount(320, 16);
    f.detectChanges();
    expect(svg()?.getAttribute('width')).toBe('288');
  });

  it('an unlaid-out host (width 0, e.g. display: none) draws nothing until the observer reports a width', () => {
    const { f, svg } = mount(0);
    f.detectChanges();
    expect(svg()).toBeNull();
    FakeResizeObserver.last!.fire(280.9);
    f.detectChanges();
    expect(svg()?.getAttribute('width')).toBe('280');
  });

  it('follows the host after that, ignores a 0 report, and disconnects on destroy', () => {
    const { f, el, svg } = mount(390);
    f.detectChanges();
    const ro = FakeResizeObserver.last!;
    expect(ro.observed).toEqual([el]);
    ro.fire(500);
    f.detectChanges();
    expect(svg()?.getAttribute('width')).toBe('500');
    ro.fire(0); // hidden: keep the last drawing, do not collapse to nothing
    f.detectChanges();
    expect(svg()?.getAttribute('width')).toBe('500');
    f.destroy();
    expect(ro.disconnected).toBe(true);
  });

  it('where there is no ResizeObserver (the unit DOM) the fallback stands, drawn at once', () => {
    TestBed.configureTestingModule({ imports: [ProbeComponent] });
    const f = TestBed.createComponent(ProbeComponent);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('svg.chart')?.getAttribute('width')).toBe('342');
  });
});
