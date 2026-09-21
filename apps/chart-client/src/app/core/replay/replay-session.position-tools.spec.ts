import { vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Candle, Session } from '@trade-automation/contracts';
import { BacktestClient } from '../api/backtest.client';
import { ReplaySessionStore } from './replay-session.store';
import type { ReplayEngine } from './replay-engine';

const bar = (close: number): Candle => ({
  instrument: 'binance:BTCUSDT', timeframe: '5m', openTime: 1_000, open: close, high: close, low: close, close, volume: 1, closed: false, source: 'resampled',
});

function setup() {
  TestBed.configureTestingModule({ providers: [ReplaySessionStore, { provide: BacktestClient, useValue: {} }] });
  const store = TestBed.inject(ReplaySessionStore);
  const series = { a: signal({ closed: [], forming: bar(100) }), b: signal({ closed: [], forming: bar(50) }) };
  store.session.set({
    balance: 10_000,
    defaultRiskPct: 1,
    layout: { panels: [{ id: 'a', instrument: 'binance:BTCUSDT' }, { id: 'b', instrument: 'binance:ETHUSDT' }] },
  } as unknown as Session);
  store.engine.set({ timeframe: signal('5m'), seriesFor: (id: 'a' | 'b') => series[id] } as unknown as ReplayEngine);
  return { store };
}

describe('ReplaySessionStore — position tools (T-022)', () => {
  it('B/S go to the panel under the pointer, else the active tool’s panel, else the first panel', () => {
    const { store } = setup();
    store.createDraft('long');
    expect(store.toolStore('a').tools()).toHaveLength(1); // nothing hovered, nothing active → first panel

    store.toolStore('b').pointerPrice.set(49);
    store.createDraft('long');
    expect(store.toolStore('b').tools().map((t) => t.entry)).toEqual([49]);

    store.toolStore('b').pointerPrice.set(null);
    store.createDraft('short'); // the active tool is on b now
    expect(store.toolStore('b').tools()).toHaveLength(2);
  });

  it('one active tool across the workspace: activating on one panel clears the other', () => {
    const { store } = setup();
    store.toolStore('a').create('long');
    store.toolStore('b').create('short');
    expect(store.toolStore('a').active()).toBeNull();
    expect(store.activeTool()?.panelId).toBe('b');
    store.toolStore('a').activate(store.toolStore('a').tools()[0].id);
    expect(store.toolStore('b').active()).toBeNull();
    expect(store.activeTool()?.panelId).toBe('a');
  });

  it("each panel source carries its tools with the session's balance and risk %", () => {
    const { store } = setup();
    store.toolStore('a').create('long');
    const view = store.sources().get('a')!.positionTools!.view();
    expect(view).toMatchObject({ balance: 10_000, riskPct: 1, pricePrecision: 2 });
    expect(view.tools).toHaveLength(1);
  });

  it('showHint sets the hint and clears it after a while', () => {
    vi.useFakeTimers();
    try {
      const { store } = setup();
      store.showHint('No active position tool — press B or S');
      expect(store.hint()).toBe('No active position tool — press B or S');
      vi.advanceTimersByTime(3_000);
      expect(store.hint()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("every tool's anchor is a bar open of the current timeframe, re-snapped on a switch (dev-1's T-030 finding)", () => {
    const { store } = setup();
    const tf = signal<'5m' | '1h'>('5m');
    const at1037 = { ...bar(100), openTime: Date.UTC(2026, 8, 18, 10, 37) }; // e.g. a 1m fill time
    store.engine.set({ timeframe: tf, seriesFor: () => signal({ closed: [], forming: at1037 }) } as unknown as ReplayEngine);
    store.toolStore('a').create('long');
    const anchor = () => store.sources().get('a')!.positionTools!.view().tools[0].anchorTime;
    expect(anchor()).toBe(Date.UTC(2026, 8, 18, 10, 35));
    tf.set('1h');
    expect(anchor()).toBe(Date.UTC(2026, 8, 18, 10, 0));
  });
});
