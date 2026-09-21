import { vi } from 'vitest';
import { Component, input, output, signal } from '@angular/core';
import type { PositionToolChange, PositionToolsView } from '../chart/overlay/position-tool.model';
import { ChartSyncService } from '../chart/chart-sync.service';
import { TestBed } from '@angular/core/testing';
import type {
  Candle,
  IndicatorPoint,
  IndicatorSeriesSpec,
  MetricPoint,
  OverlayPrimitive,
  Panel,
  Timeframe,
} from '@trade-automation/contracts';
import { ChartComponent } from '../chart/chart.component';
import { ChartPanelComponent } from './chart-panel.component';
import type { PanelSource } from './panel-source';

/**
 * backtest-app-system-design.md §2.3 (D2): the panel renders from ANY `PanelSource`. The source
 * here is plain signals — no `PanelFeed`, no REST, no socket — which is what T-020's replay
 * source will be. `<app-chart>` is swapped for a recording stub: lightweight-charts needs a
 * real canvas, and what matters here is what the panel binds, not how the chart draws it.
 */
@Component({ selector: 'app-chart', template: '' })
class ChartStubComponent {
  readonly panelId = input.required<string>();
  readonly kind = input.required<'candles' | 'metric'>();
  readonly candles = input<Candle[]>([]);
  readonly points = input<MetricPoint[]>([]);
  readonly overlays = input<OverlayPrimitive[]>([]);
  readonly indicatorPoints = input<IndicatorPoint[]>([]);
  readonly indicatorSpecs = input<ReadonlyMap<string, IndicatorSeriesSpec>>(new Map());
  readonly timeframe = input.required<Timeframe>();
  readonly positionTools = input<PositionToolsView | null>(null);
  readonly positionToolsEnabled = input(false);
  readonly positionToolChange = output<PositionToolChange>();
  readonly loadOlderRequested = output<void>();
  readonly crosshairPrice = signal<number | null>(null);
}

const PANEL: Panel = { id: 'replay-btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false };

function candle(openTime: number): Candle {
  return {
    instrument: 'binance:BTCUSDT',
    timeframe: '5m',
    openTime,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 10,
    closed: true,
    source: 'venue-rest',
  };
}

function stubSource() {
  const overlay: OverlayPrimitive = { type: 'priceLine', price: 1.5, label: 'entry' };
  const spec = { label: 'EMA' } as unknown as IndicatorSeriesSpec;
  return {
    panel: PANEL,
    candles: signal<readonly Candle[]>([candle(0), candle(300_000)]),
    points: signal<readonly MetricPoint[]>([]),
    overlays: signal<readonly OverlayPrimitive[]>([overlay]),
    indicatorPoints: signal<readonly IndicatorPoint[]>([]),
    indicatorSpecs: signal<ReadonlyMap<string, IndicatorSeriesSpec>>(new Map([['ema:ema', spec]])),
    loadOlder: vi.fn().mockResolvedValue(undefined),
  } satisfies PanelSource;
}

function render(source: PanelSource) {
  TestBed.overrideComponent(ChartPanelComponent, {
    remove: { imports: [ChartComponent] },
    add: { imports: [ChartStubComponent] },
  });
  const fixture = TestBed.createComponent(ChartPanelComponent);
  fixture.componentRef.setInput('panel', PANEL);
  fixture.componentRef.setInput('source', source);
  fixture.detectChanges();
  const chart = fixture.debugElement.query((de) => de.componentInstance instanceof ChartStubComponent)
    .componentInstance as ChartStubComponent;
  return { fixture, chart, el: fixture.nativeElement as HTMLElement };
}

describe('ChartPanelComponent with a stub PanelSource (not a PanelFeed)', () => {
  it('renders the panel and binds every source signal to the chart', () => {
    const source = stubSource();
    const { chart, el } = render(source);

    expect(el.querySelector('.chart-panel')?.getAttribute('data-panel-id')).toBe('replay-btc');
    expect(chart.panelId()).toBe('replay-btc');
    expect(chart.kind()).toBe('candles');
    expect(chart.candles()).toBe(source.candles());
    expect(chart.overlays()).toBe(source.overlays());
    expect(chart.indicatorSpecs()).toBe(source.indicatorSpecs());
  });

  it('follows the source as it changes, as a replay step would', () => {
    const source = stubSource();
    const { fixture, chart } = render(source);

    source.candles.update((bars) => [...bars, candle(600_000)]);
    fixture.detectChanges();
    expect(chart.candles().map((c) => c.openTime)).toEqual([0, 300_000, 600_000]);
  });

  it('asks the source, not a layout feed, for older history', () => {
    const source = stubSource();
    const { chart } = render(source);

    chart.loadOlderRequested.emit();
    expect(source.loadOlder).toHaveBeenCalledTimes(1);
  });

  it('without position tools the chart draws none and ignores hits (the live terminal)', () => {
    const { chart } = render(stubSource());
    expect(chart.positionTools()).toBeNull();
    expect(chart.positionToolsEnabled()).toBe(false);
  });

  it('with position tools: the view goes to the chart, its changes to the source (T-022)', () => {
    const view: PositionToolsView = { tools: [], balance: 10_000, riskPct: 1, pricePrecision: 2 };
    const tools = { view: signal(view), apply: vi.fn(), setPointerPrice: vi.fn() };
    const { chart } = render({ ...stubSource(), positionTools: tools });
    expect(chart.positionTools()).toBe(view);
    expect(chart.positionToolsEnabled()).toBe(true);
    chart.positionToolChange.emit({ type: 'activate', id: 't1' });
    expect(tools.apply).toHaveBeenCalledWith({ type: 'activate', id: 't1' });
  });

  it('reports the pointer price only while this panel drives the shared crosshair', () => {
    TestBed.configureTestingModule({ providers: [ChartSyncService] });
    const tools = { view: signal({ tools: [], balance: 1, riskPct: 1, pricePrecision: 2 }), apply: vi.fn(), setPointerPrice: vi.fn() };
    const { fixture, chart } = render({ ...stubSource(), positionTools: tools });
    const sync = TestBed.inject(ChartSyncService);

    chart.crosshairPrice.set(101.5);
    sync.setCrosshair('replay-btc', 1_000);
    fixture.detectChanges();
    expect(tools.setPointerPrice).toHaveBeenLastCalledWith(101.5);

    sync.setCrosshair('another-panel', 1_000); // this panel only follows: not where the user points
    fixture.detectChanges();
    expect(tools.setPointerPrice).toHaveBeenLastCalledWith(null);
  });

  it('renders without a researchScope (no research strategy in replay)', () => {
    const { el } = render(stubSource());
    expect(el.querySelector('app-research-badge')).not.toBeNull();
    expect(el.querySelector('app-research-badge .research-badge')).toBeNull();
  });
});
