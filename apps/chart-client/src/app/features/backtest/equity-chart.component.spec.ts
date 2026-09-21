import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { EquityPoint } from '@trade-automation/contracts';
import { LineType } from 'lightweight-charts';
import { EQUITY_CHART_FACTORY, EquityChartComponent } from './equity-chart.component';

const CURVE: EquityPoint[] = [
  { time: 0, balance: 10_000, balanceR: 0 },
  { time: 60_000, balance: 10_200, balanceR: 2 },
  { time: 120_000, balance: 10_050, balanceR: 0.5 },
];

function fakeChart() {
  const series: Array<{ options: Record<string, unknown>; setData: ReturnType<typeof vi.fn> }> = [];
  const chart = {
    addSeries: vi.fn((_type: unknown, options: Record<string, unknown>) => {
      const s = { options, setData: vi.fn(), priceScale: () => ({ applyOptions: vi.fn() }) };
      series.push(s);
      return s;
    }),
    priceScale: () => ({ applyOptions: vi.fn() }),
    timeScale: () => ({ fitContent: vi.fn() }),
    remove: vi.fn(),
  };
  return { chart, series };
}

function render(unit: 'ccy' | 'r' = 'ccy') {
  const { chart, series } = fakeChart();
  TestBed.configureTestingModule({ imports: [EquityChartComponent], providers: [{ provide: EQUITY_CHART_FACTORY, useValue: () => chart }] });
  const fixture = TestBed.createComponent(EquityChartComponent);
  fixture.componentRef.setInput('points', CURVE);
  fixture.componentRef.setInput('unit', unit);
  fixture.detectChanges();
  return { fixture, chart, series, el: fixture.nativeElement as HTMLElement };
}

describe('EquityChartComponent', () => {
  it('draws the curve as a step line and the drawdown underneath', () => {
    const { series } = render();
    expect(series[0].options['lineType']).toBe(LineType.WithSteps);
    expect(series[0].setData).toHaveBeenLastCalledWith([
      { time: 0, value: 10_000 },
      { time: 60, value: 10_200 },
      { time: 120, value: 10_050 },
    ]);
    expect(series[1].setData).toHaveBeenLastCalledWith([
      { time: 0, value: 0 },
      { time: 60, value: 0 },
      { time: 120, value: -150 },
    ]);
  });

  it('switches to R without rebuilding the chart', () => {
    const { fixture, chart, series } = render();
    fixture.componentRef.setInput('unit', 'r');
    fixture.detectChanges();
    expect(chart.addSeries).toHaveBeenCalledTimes(2);
    expect(series[0].setData).toHaveBeenLastCalledWith([
      { time: 0, value: 0 },
      { time: 60, value: 2 },
      { time: 120, value: 0.5 },
    ]);
  });

  it('lists every raw point for the diff and for screen readers', () => {
    const { el } = render();
    const items = el.querySelectorAll('[data-testid="equity-points"] li');
    expect(items).toHaveLength(3);
    expect(items[1].getAttribute('data-balance')).toBe('10200');
    expect(items[1].getAttribute('data-balance-r')).toBe('2');
  });

  it('removes the chart with the component', () => {
    const { fixture, chart } = render();
    fixture.destroy();
    expect(chart.remove).toHaveBeenCalled();
  });
});
