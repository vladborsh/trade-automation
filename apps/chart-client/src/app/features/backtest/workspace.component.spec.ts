import { vi } from 'vitest';
import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Panel, Session, Timeframe } from '@trade-automation/contracts';
import { ReplaySessionStore } from '../../core/replay/replay-session.store';
import { PortfolioStore } from '../../core/replay/portfolio.store';
import { PanelGridComponent } from '../panel-grid/panel-grid.component';
import { WorkspaceComponent } from './workspace.component';

/** Records what the workspace hands the grid; the real grid has its own specs and the e2e. */
@Component({ selector: 'app-panel-grid', template: '' })
class PanelGridStubComponent {
  readonly panels = input<readonly Panel[] | null>(null);
  readonly sources = input<ReadonlyMap<string, unknown> | null>(null);
  readonly timeframe = input<Timeframe | null>(null);
}

const SESSION = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'BTC practice',
  sessionCurrency: 'USD',
  balance: 10_000,
  layout: { panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }] },
} as unknown as Session;

function fakeStore() {
  const engine = {
    cursor: signal(Date.UTC(2026, 8, 18, 23, 45)),
    timeframe: signal<Timeframe>('5m'),
    blocked: signal(false),
    atEnd: signal(false),
    completed: signal(false),
    error: signal<string | null>(null),
    step: vi.fn().mockResolvedValue(undefined),
    setTimeframe: vi.fn().mockResolvedValue(undefined),
  };
  const store = {
    session: signal<Session | null>(null),
    engine: signal<typeof engine | null>(null),
    loadError: signal<string | null>(null),
    retrying: signal(false),
    notice: signal<string | null>(null),
    sources: signal(new Map()),
    portfolio: new PortfolioStore(),
    pricePrecision: signal(new Map()),
    open: vi.fn(async () => {
      store.session.set(SESSION);
      store.engine.set(engine);
    }),
  };
  return { store, engine };
}

async function render() {
  const { store, engine } = fakeStore();
  TestBed.configureTestingModule({ imports: [WorkspaceComponent], providers: [provideRouter([])] });
  TestBed.overrideComponent(WorkspaceComponent, {
    set: { providers: [{ provide: ReplaySessionStore, useValue: store }] },
  });
  TestBed.overrideComponent(WorkspaceComponent, {
    remove: { imports: [PanelGridComponent] },
    add: { imports: [PanelGridStubComponent] },
  });
  const fixture = TestBed.createComponent(WorkspaceComponent);
  fixture.componentRef.setInput('id', SESSION.id);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, store, engine, el: fixture.nativeElement as HTMLElement };
}

function press(key: string, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('WorkspaceComponent', () => {
  it('opens the session from the route id and shows its toolbar', async () => {
    const { store, el } = await render();
    expect(store.open).toHaveBeenCalledWith(SESSION.id);
    expect(el.querySelector('app-replay-toolbar .name')?.textContent).toBe('BTC practice');
    expect(el.querySelector('[data-testid="replay-cursor"]')?.textContent).toBe('2026-09-18 23:45 UTC');
  });

  it('hands the grid the session panels, their replay sources and the session timeframe', async () => {
    const { fixture, store } = await render();
    const grid = fixture.debugElement.query((de) => de.componentInstance instanceof PanelGridStubComponent)
      .componentInstance as PanelGridStubComponent;
    expect(grid.panels()).toEqual(SESSION.layout.panels);
    expect(grid.sources()).toBe(store.sources());
    expect(grid.timeframe()).toBe('5m');
  });

  it('shows the journal and the statistics under the grid', async () => {
    const { el } = await render();
    expect(el.querySelector('.bottom app-journal')).not.toBeNull();
    expect(el.querySelector('.bottom app-stats-summary')).not.toBeNull();
  });

  it('→ steps and [ / ] switch to the neighbouring timeframe', async () => {
    const { engine } = await render();
    expect(press('ArrowRight').defaultPrevented).toBe(true);
    press(']');
    press('[');
    expect(engine.step).toHaveBeenCalledTimes(1);
    expect(engine.setTimeframe.mock.calls).toEqual([['15m'], ['1m']]);
  });

  it('keys are inert once the session is complete', async () => {
    const { engine, fixture, el } = await render();
    engine.completed.set(true);
    fixture.detectChanges();
    press('ArrowRight');
    press(']');
    expect(engine.step).not.toHaveBeenCalled();
    expect(engine.setTimeframe).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="replay-completed"]')).not.toBeNull();
  });

  it('ignores the hotkeys while typing', async () => {
    const { engine, el } = await render();
    const input = document.createElement('input');
    el.appendChild(input);
    press('ArrowRight', input);
    press(']', input);
    expect(engine.step).not.toHaveBeenCalled();
    expect(engine.setTimeframe).not.toHaveBeenCalled();
  });

  it('removes its key listener with the route', async () => {
    const { fixture, engine } = await render();
    fixture.destroy();
    press('ArrowRight');
    expect(engine.step).not.toHaveBeenCalled();
  });

  it('shows why a session could not be opened', async () => {
    const { store } = fakeStore();
    store.open.mockImplementation(async () => store.loadError.set('HTTP 404'));
    TestBed.configureTestingModule({ imports: [WorkspaceComponent], providers: [provideRouter([])] });
    TestBed.overrideComponent(WorkspaceComponent, { set: { providers: [{ provide: ReplaySessionStore, useValue: store }] } });
    TestBed.overrideComponent(WorkspaceComponent, { remove: { imports: [PanelGridComponent] }, add: { imports: [PanelGridStubComponent] } });
    const fixture = TestBed.createComponent(WorkspaceComponent);
    fixture.componentRef.setInput('id', 'x');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain('HTTP 404');
  });
});
