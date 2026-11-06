import { describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import type { WebOiDivergenceLine } from '@trade-automation/contracts';
import { DivergenceOverlay } from './divergence-overlay';
import type { PaneData } from './pane-data';

/**
 * IB-110 — the page's divergence lines merged into the chart's data. The panes here are shaped as the page
 * builds them (`instrument` is venue-qualified: `binance:BTCUSDT`) — a merge keyed on the bare symbol
 * matched nothing on the slot, and this spec now pins it.
 */
const line = { direction: 'bullish', kind: 'regular', a: { time: 1, price: 1, oiTime: 1, oi: 1 }, b: { time: 2, price: 1, oiTime: 2, oi: 1 },
  confirmedAt: 3, pricePct: 0, oiPct: 0, repeat: null, firedAt: null } as WebOiDivergenceLine;
const hiddenLine = { ...line, kind: 'hidden', b: { ...line.b, time: 4 } } as WebOiDivergenceLine;
const panes = (instrument: string, timeframe: string) => ({ instrument, timeframe }) as unknown as PaneData;

function build(lines: WebOiDivergenceLine[] = [line]) {
  const prefs = {
    hidden: signal(false), hiddenKindHidden: signal(false),
    toggle(kind: 'regular' | 'hidden' = 'regular') { (kind === 'hidden' ? this.hiddenKindHidden : this.hidden).update((h) => !h); },
  };
  const asked: string[] = [];
  const api = { oiDivergences: async (symbol: string, tf: string) => { asked.push(`${symbol}:${tf}`); return { lines }; } };
  return { overlay: new DivergenceOverlay(api as never, prefs as never), prefs, asked };
}

describe('DivergenceOverlay', () => {
  it('lines asked for the bare symbol reach the chart data of the venue-qualified window', async () => {
    const { overlay, asked } = build();
    await overlay.load('BTCUSDT', '1h');
    expect(asked).toEqual(['BTCUSDT:1h']);
    expect(overlay.merge(panes('binance:BTCUSDT', '1h'))?.divergences).toEqual([line]);
  });

  it('another symbol or frame on screen gets none (the lines are for what was asked)', async () => {
    const { overlay } = build();
    await overlay.load('BTCUSDT', '1h');
    expect(overlay.merge(panes('binance:ETHUSDT', '1h'))?.divergences).toBeUndefined();
    expect(overlay.merge(panes('binance:BTCUSDT', '4h'))?.divergences).toBeUndefined();
  });

  it('a frame without divergences (1m, 1d) asks for nothing', async () => {
    const { overlay, asked } = build();
    await overlay.load('BTCUSDT', '1m');
    await overlay.load('BTCUSDT', '1d');
    expect(asked).toEqual([]);
    expect(overlay.merge(panes('binance:BTCUSDT', '1m'))?.divergences).toBeUndefined();
  });

  it('hidden: an EMPTY list (the legend keeps its switch), and the switch redraws in place (extendsLater)', async () => {
    const { overlay, prefs } = build();
    await overlay.load('BTCUSDT', '1h');
    const p = panes('binance:BTCUSDT', '1h');
    expect(overlay.merge(p)?.divergences).toEqual([line]);
    prefs.toggle();
    const hidden = overlay.merge(p)!;
    expect(hidden.divergences).toEqual([]);
    expect(hidden.extendsLater).toBe(true); // same window: the reader's view is kept
    expect(overlay.merge(panes('binance:BTCUSDT', '1h'))?.extendsLater).toBeUndefined(); // a new window draws fresh
  });

  it('IB-144 (V44): each kind has its own switch — hiding one leaves the other drawn, and each switch redraws in place', async () => {
    const { overlay, prefs } = build([line, hiddenLine]);
    await overlay.load('BTCUSDT', '1h');
    const p = panes('binance:BTCUSDT', '1h');
    expect(overlay.merge(p)?.divergences).toEqual([line, hiddenLine]);
    prefs.toggle('hidden');
    const noHidden = overlay.merge(p)!;
    expect(noHidden.divergences).toEqual([line]);
    expect(noHidden.extendsLater).toBe(true);
    prefs.toggle('regular');
    expect(overlay.merge(p)?.divergences).toEqual([]); // both off: an empty list, the legend keeps both switches
    prefs.toggle('hidden');
    const onlyHidden = overlay.merge(p)!;
    expect(onlyHidden.divergences).toEqual([hiddenLine]);
    expect(onlyHidden.extendsLater).toBe(true);
  });

  it('IB-129: a hidden alert kind is left out of the marks (an empty list keeps the switch), the hidden lines are named, and each switch redraws in place', async () => {
    const { overlay, prefs } = build();
    let off = { liqAlerts: false, fundingAlerts: false, prevMonth: false, weekOpen: false, monthOpen: false };
    const layers = { off: () => off };
    const withLayers = new DivergenceOverlay({ oiDivergences: async () => ({ lines: [] }) } as never, prefs as never, layers as never);
    const liq = { type: 'liq', at: 1 } as never;
    const fund = { type: 'funding', at: 2 } as never;
    const p = { ...panes('binance:BTCUSDT', '1m'), alertMarks: [liq, fund] } as PaneData;
    expect(withLayers.merge(p)?.alertMarks).toEqual([liq, fund]);
    off = { ...off, liqAlerts: true };
    const noLiq = withLayers.merge(p)!;
    expect(noLiq.alertMarks).toEqual([fund]);
    expect(noLiq.extendsLater).toBe(true);
    off = { ...off, fundingAlerts: true, monthOpen: true };
    const none = withLayers.merge(p)!;
    expect(none.alertMarks).toEqual([]);
    expect(none.layersOff).toMatchObject({ monthOpen: true, prevMonth: false });
    expect(none.extendsLater).toBe(true);
    // a failed marks read stays absent; without layer prefs nothing is off
    expect(withLayers.merge({ ...panes('binance:BTCUSDT', '1m') } as PaneData)?.alertMarks).toBeUndefined();
    expect(overlay.merge(p)?.alertMarks).toEqual([liq, fund]);
  });
});
