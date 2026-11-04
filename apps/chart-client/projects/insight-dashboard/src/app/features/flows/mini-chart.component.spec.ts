import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MiniChartComponent } from './mini-chart.component';

/** IB-091 — in a DOM with no canvas (jsdom) the chart is simply not drawn; the box is still there. */
describe('MiniChartComponent', () => {
  it('renders its box and does not throw without a canvas', () => {
    TestBed.configureTestingModule({ imports: [MiniChartComponent] });
    const f = TestBed.createComponent(MiniChartComponent);
    f.componentRef.setInput('series', [{ time: 1, value: 1 }, { time: 2, value: 2 }]);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.box')).not.toBeNull();
  });
});
