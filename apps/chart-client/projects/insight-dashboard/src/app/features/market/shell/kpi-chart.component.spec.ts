import { TestBed } from '@angular/core/testing';
import type { WebKpiHistory } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { kpiChartGeometry, type KpiChartGeometry } from './kpi-chart';
import { KpiChartComponent } from './kpi-chart.component';

/** IB-118 — the chart as rendered: a path per unbroken run, three dots, bars by side, the newest lit. */
function render(geometry: KpiChartGeometry): HTMLElement {
  const f = TestBed.createComponent(KpiChartComponent);
  f.componentRef.setInput('geometry', geometry);
  f.componentRef.setInput('label', '7д мин $2.61T / макс $2.79T');
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}
const h = (kind: WebKpiHistory['kind'], values: number[], times?: number[]): WebKpiHistory => {
  const points = values.map((value, i) => ({ time: times ? times[i] : i * 600, value }));
  return { kind, points, from: points[0].time, to: points[points.length - 1].time, min: Math.min(...values), max: Math.max(...values), breakAfterSec: kind === 'area' ? 1800 : null };
};

describe('KpiChartComponent', () => {
  it('area: one line per run (a gap draws two), min / max / last dots placed by percent, the down tone', () => {
    const el = render(kpiChartGeometry(h('area', [5, 9, 1, 4], [0, 600, 9000, 9600])) as KpiChartGeometry);
    expect(el.querySelectorAll('path.line')).toHaveLength(2);
    expect(el.querySelector('svg')?.classList).toContain('down');
    const dot = (d: string) => el.querySelector<HTMLElement>(`[data-dot="${d}"]`);
    expect(dot('max')?.style.top).toBe('10%');
    expect(dot('min')?.style.top).toBe('90%');
    expect(dot('last')?.style.left).toBe('100%');
    expect(el.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('7д мин $2.61T / макс $2.79T');
  });

  it('bars: one per settlement, amber above zero and blue below, only the newest lit', () => {
    const el = render(kpiChartGeometry(h('bars', [0.0001, -0.00005, 0.00008])) as KpiChartGeometry);
    const bars = [...el.querySelectorAll<HTMLElement>('.bar')];
    expect(bars.map((b) => [...b.classList].filter((c) => c !== 'bar').sort().join(' '))).toEqual(['longs_pay', 'shorts_pay', 'lit longs_pay']);
    expect(el.querySelector('.zero')).not.toBeNull();
  });
});
