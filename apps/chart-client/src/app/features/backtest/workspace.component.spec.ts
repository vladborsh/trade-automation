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
    started: signal(false),
    stepQueued: signal(false),
    atEnd: signal(false),
    completed: signal(false),
    halted: signal(false),
    viewOnly: false,
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
    halted: signal<string | null>(null),
    sources: signal(new Map()),
    portfolio: new PortfolioStore(),
    pricePrecision: signal(new Map()),
    instruments: { contractOf: vi.fn((): unknown => null), units: signal(new Map()) },
    margin: signal<unknown>(null),
    marginUtilisation: signal<number | null>(null),
    hint: signal<string | null>(null),
    activeDraft: null as null | Record<string, unknown>,
    removeActiveDraft: vi.fn(() => true),
    createDraft: vi.fn(),
    /** Bumped by a spec after changing `activeDraft`, so the workspace's computeds see it. */
    draftVersion: signal(0),
    activeTool: vi.fn((): unknown => (store.draftVersion() >= 0 && store.activeDraft ? { panelId: 'btc', store: { active: () => store.activeDraft, removeActiveDraft: store.removeActiveDraft } } : null)),
    showHint: vi.fn((message: string) => store.hint.set(message)),
    placeActiveDraft: vi.fn(),
    riskPct: signal(1),
    riskPctOverride: signal<number | null>(null),
    positions: signal({ rows: [], openRisk: 0 }),
    lastCloseOf: vi.fn(() => 100),
    cancelOrder: vi.fn(),
    closeOrder: vi.fn(),
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
    expect(store.open).toHaveBeenCalledWith(SESSION.id, null);
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

  it('marks the workspace data-replay-started once the engine has its first history (BUG-010)', async () => {
    const { fixture, engine, el } = await render();
    const root = el.querySelector('.workspace')!;
    expect(root.hasAttribute('data-replay-started')).toBe(false);
    engine.started.set(true);
    fixture.detectChanges();
    expect(root.hasAttribute('data-replay-started')).toBe(true);
  });

  it('shows the journal and the statistics under the grid', async () => {
    const { el } = await render();
    expect(el.querySelector('app-layout-editor')).not.toBeNull(); // the live workspace offers it
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

  it('T-052: Play steps the engine every 0.5 s; a hidden tab and a new engine pause it', async () => {
    vi.useFakeTimers();
    try {
      const { fixture, store, engine, el } = await render();
      engine.started.set(true);
      fixture.detectChanges();
      el.querySelector<HTMLButtonElement>('[data-testid="replay-play"]')!.click();
      vi.advanceTimersByTime(1_500);
      expect(engine.step).toHaveBeenCalledTimes(3);

      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(2_000);
      expect(engine.step).toHaveBeenCalledTimes(3);
      expect(fixture.componentInstance.autoplay.playing()).toBe(false);
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });

      fixture.componentInstance.autoplay.play();
      store.engine.set({ ...engine }); // a reload builds a new engine
      fixture.detectChanges();
      expect(fixture.componentInstance.autoplay.playing()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('T-059 × T-052: a halt while playing pauses Play by itself; Play is disabled while halted', async () => {
    vi.useFakeTimers();
    try {
      const { fixture, store, engine, el } = await render();
      engine.started.set(true);
      fixture.detectChanges();
      el.querySelector<HTMLButtonElement>('[data-testid="replay-play"]')!.click();
      vi.advanceTimersByTime(1_000);
      expect(engine.step).toHaveBeenCalledTimes(2);

      engine.halted.set(true); // the server answered VALUE_OUT_OF_RANGE
      store.halted.set('This session has reached the numeric limit; create a new session');
      vi.advanceTimersByTime(2_000);
      fixture.detectChanges();
      expect(engine.step).toHaveBeenCalledTimes(2); // no further tick stepped
      expect(fixture.componentInstance.autoplay.playing()).toBe(false);
      expect(el.querySelector<HTMLButtonElement>('[data-testid="replay-play"]')!.disabled).toBe(true);
      fixture.componentInstance.autoplay.play(); // and it cannot be restarted
      expect(fixture.componentInstance.autoplay.playing()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('?viewAt&order opens the view-only rewind: → is inert, [ ] still switch timeframe (§9.3)', async () => {
    const { store, engine } = fakeStore();
    (engine as { viewOnly: boolean }).viewOnly = true;
    TestBed.configureTestingModule({ imports: [WorkspaceComponent], providers: [provideRouter([])] });
    TestBed.overrideComponent(WorkspaceComponent, { set: { providers: [{ provide: ReplaySessionStore, useValue: store }] } });
    TestBed.overrideComponent(WorkspaceComponent, { remove: { imports: [PanelGridComponent] }, add: { imports: [PanelGridStubComponent] } });
    const fixture = TestBed.createComponent(WorkspaceComponent);
    fixture.componentRef.setInput('id', SESSION.id);
    fixture.componentRef.setInput('viewAt', '1789552200000');
    fixture.componentRef.setInput('order', 'o1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.open).toHaveBeenCalledWith(SESSION.id, { viewAt: 1789552200000, orderId: 'o1' });
    press('ArrowRight');
    press('b');
    press('S');
    press('Enter');
    press(']');
    expect(engine.step).not.toHaveBeenCalled();
    expect(store.createDraft).not.toHaveBeenCalled(); // no tool…
    expect(store.activeTool).not.toHaveBeenCalled(); // …and no order from one
    expect(engine.setTimeframe).toHaveBeenCalledWith('15m');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="replay-viewing"]')).not.toBeNull();
    // Editing the layout PATCHes the session: not offered while viewing the past.
    expect((fixture.nativeElement as HTMLElement).querySelector('app-layout-editor')).toBeNull();
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

  it('T-059: once halted (numeric limit) keys are inert, the Buy/Sell/Place controls are off and the notice stays', async () => {
    const { store, engine, fixture, el } = await render();
    engine.halted.set(true);
    store.halted.set('This session has reached the numeric limit; create a new session');
    fixture.detectChanges();
    for (const key of ['ArrowRight', ']', 'b', 's', 'Enter']) press(key);
    expect(engine.step).not.toHaveBeenCalled();
    expect(engine.setTimeframe).not.toHaveBeenCalled();
    expect(store.createDraft).not.toHaveBeenCalled();
    expect(store.placeActiveDraft).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="replay-halted"]')?.textContent).toBe('This session has reached the numeric limit; create a new session');
    expect(el.querySelector<HTMLButtonElement>('[data-testid="trade-buy"]')!.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('[data-testid="trade-place"]')!.disabled).toBe(true);
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

  it('B / S create a long / short draft; Esc removes the active draft (T-022, decision 37b)', async () => {
    const { store } = await render();
    press('b');
    press('S');
    expect(store.createDraft.mock.calls).toEqual([['long'], ['short']]);
    store.activeDraft = { kind: 'draft', id: 't1' };
    press('Escape');
    expect(store.removeActiveDraft).toHaveBeenCalledTimes(1);
  });

  const DRAFT = { id: 't1', kind: 'draft', side: 'long', mode: 'limit', entry: 99, sl: 98, tp: 101, active: true, anchorTime: 0 };

  it('T-045: B/S never open the order popup; Enter on the active draft does, and a second Enter confirms', async () => {
    const { fixture, store, engine, el } = await render();
    press('b');
    store.activeDraft = DRAFT; // the draft B created (the fake store does not create one)
    store.draftVersion.update((v) => v + 1);
    fixture.detectChanges();
    expect(el.querySelector('app-order-panel')).toBeNull(); // the levels are set on the chart first

    press('Enter');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="order-popup"]')).not.toBeNull();
    expect(store.placeActiveDraft).not.toHaveBeenCalled(); // the popup is the submit step
    press('ArrowRight'); // modal: nothing else acts
    press('s');
    expect(engine.step).not.toHaveBeenCalled();
    expect(store.createDraft.mock.calls).toEqual([['long']]); // only the B from before
    press('Enter');
    fixture.detectChanges();
    expect(store.placeActiveDraft).toHaveBeenCalledTimes(1);
    expect(el.querySelector('app-order-panel')).toBeNull();
  });

  it('T-045: Esc closes the popup and keeps the draft; the popup Cancel does the same', async () => {
    const { fixture, store, el } = await render();
    store.activeDraft = DRAFT;
    store.draftVersion.update((v) => v + 1);
    press('Enter');
    fixture.detectChanges();
    press('Escape');
    fixture.detectChanges();
    expect(el.querySelector('app-order-panel')).toBeNull();
    expect(store.removeActiveDraft).not.toHaveBeenCalled();
    press('Enter');
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('[data-testid="order-cancel"]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('app-order-panel')).toBeNull();
    expect(store.placeActiveDraft).not.toHaveBeenCalled();
  });

  it('T-045: keys typed inside the popup are its own, not the workspace hotkeys', async () => {
    const { fixture, store, el } = await render();
    store.activeDraft = DRAFT;
    store.draftVersion.update((v) => v + 1);
    press('Enter');
    fixture.detectChanges();
    const cancel = el.querySelector<HTMLButtonElement>('[data-testid="order-cancel"]')!;
    press('Enter', cancel); // a focused button: the browser clicks it; the window handler must not confirm too
    expect(store.placeActiveDraft).not.toHaveBeenCalled();
  });

  it('T-045: the popup closes when its draft goes away', async () => {
    const { fixture, store, el } = await render();
    store.activeDraft = DRAFT;
    store.draftVersion.update((v) => v + 1);
    press('Enter');
    fixture.detectChanges();
    store.activeDraft = null;
    store.draftVersion.update((v) => v + 1);
    fixture.detectChanges();
    expect(el.querySelector('app-order-panel')).toBeNull();
    store.activeDraft = DRAFT; // a new draft later does not bring the popup back by itself
    store.draftVersion.update((v) => v + 1);
    fixture.detectChanges();
    expect(el.querySelector('app-order-panel')).toBeNull();
  });

  it('Enter without an active draft goes to the store, which only hints (decision 29)', async () => {
    const { fixture, store, el } = await render();
    press('Enter');
    expect(store.placeActiveDraft).toHaveBeenCalledTimes(1);
    store.showHint('No active position tool — press B or S');
    fixture.detectChanges();
    expect(el.querySelector('.hint[role="status"]')?.textContent).toBe('No active position tool — press B or S');
    expect(store.createDraft).not.toHaveBeenCalled();
  });

  it('the positions behind a toolbar dropdown (T-046), the open risk; the order panel only as the submit popup (T-045)', async () => {
    const { el } = await render();
    expect(el.querySelector('app-order-panel')).toBeNull();
    expect(el.querySelector('app-positions-panel')).toBeNull(); // no always-visible list
    expect(el.querySelector('app-replay-toolbar app-positions-dropdown [data-testid="positions-toggle"]')).not.toBeNull();
    expect(el.querySelector('.side')).toBeNull(); // the chart grid has the full width
    expect(el.querySelector('[data-testid="replay-open-risk"]')?.textContent).toContain('0.00');
  });

  it('T-046: keys on the positions dropdown are its own — Enter on a Close button opens no order popup, Esc removes no draft', async () => {
    const { fixture, store, el } = await render();
    store.activeDraft = DRAFT;
    store.draftVersion.update((v) => v + 1);
    const toggle = el.querySelector<HTMLButtonElement>('[data-testid="positions-toggle"]')!;
    press('Enter', toggle);
    press('Escape', toggle);
    fixture.detectChanges();
    expect(el.querySelector('app-order-panel')).toBeNull();
    expect(store.removeActiveDraft).not.toHaveBeenCalled();
  });

  it('T-046: with focus left on the positions toggle, → and B still act', async () => {
    const { store, engine, el } = await render();
    const toggle = el.querySelector<HTMLButtonElement>('[data-testid="positions-toggle"]')!;
    press('ArrowRight', toggle);
    press('b', toggle);
    expect(engine.step).toHaveBeenCalledTimes(1);
    expect(store.createDraft).toHaveBeenCalledWith('long');
  });

  it('T-048: Buy / Sell / Place in the toolbar run the same paths as B / S / Enter', async () => {
    const { fixture, store, el } = await render();
    const btn = (id: string) => el.querySelector<HTMLButtonElement>(`app-replay-toolbar [data-testid="trade-${id}"]`)!;
    btn('buy').click();
    btn('sell').click();
    expect(store.createDraft.mock.calls).toEqual([['long'], ['short']]);

    btn('place').click(); // no active draft: the store's hint only (decision 29)
    expect(store.placeActiveDraft).toHaveBeenCalledTimes(1);
    fixture.detectChanges();
    expect(el.querySelector('app-order-panel')).toBeNull();

    store.activeDraft = DRAFT;
    store.draftVersion.update((v) => v + 1);
    btn('place').click(); // with one: the order popup, as Enter
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="order-popup"]')).not.toBeNull();
    expect(store.placeActiveDraft).toHaveBeenCalledTimes(1);
  });

  it('T-048: the trade controls are disabled once the session is complete; Enter on them is theirs', async () => {
    const { fixture, store, engine, el } = await render();
    store.activeDraft = DRAFT;
    store.draftVersion.update((v) => v + 1);
    press('Enter', el.querySelector('[data-testid="trade-buy"]')!); // the focused button's own Enter
    fixture.detectChanges();
    expect(el.querySelector('app-order-panel')).toBeNull();
    engine.completed.set(true);
    fixture.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('[data-testid="trade-buy"]')!.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('[data-testid="trade-place"]')!.disabled).toBe(true);
  });

  it('B / S / Esc / Enter are ignored while typing', async () => {
    const { store, el } = await render();
    const input = document.createElement('input');
    el.appendChild(input);
    for (const key of ['b', 's', 'Escape', 'Enter']) press(key, input);
    expect(store.createDraft).not.toHaveBeenCalled();
    expect(store.placeActiveDraft).not.toHaveBeenCalled();
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
