import { describe, expect, it } from 'vitest';
import {
  DIVERGENCES_HIDDEN_KEY, HIDDEN_DIVERGENCES_HIDDEN_KEY, LEGENDS_HIDDEN_KEY, loadDivergencesHidden, loadLegendsHidden,
  saveDivergencesHidden, saveLegendsHidden, CHART_LAYERS, layerHiddenKey, loadLayerHidden, saveLayerHidden,
  PHONE_LAYERS_OPEN_KEY, loadPhoneLayersOpen, savePhoneLayersOpen,
} from './chart-prefs';

/** IB-099 item 2 — the legend toggle is remembered, and a hostile store costs nothing. */
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const throwing = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceeded'); } };

describe('legends hidden — remembered per viewer', () => {
  it('shown by default; a saved choice comes back', () => {
    const s = memory();
    expect(loadLegendsHidden(s)).toBe(false);
    saveLegendsHidden(s, true);
    expect(s.m.get(LEGENDS_HIDDEN_KEY)).toBe('1');
    expect(loadLegendsHidden(s)).toBe(true);
    saveLegendsHidden(s, false);
    expect(loadLegendsHidden(s)).toBe(false);
  });
  it('a store that throws or is missing: shown, and saving does not throw', () => {
    expect(loadLegendsHidden(throwing)).toBe(false);
    expect(() => saveLegendsHidden(throwing, true)).not.toThrow();
    expect(loadLegendsHidden(null)).toBe(false);
    expect(() => saveLegendsHidden(null, true)).not.toThrow();
  });
});

describe('divergence switches (IB-110, IB-144) — one remembered pref per kind, independent', () => {
  it('regular and hidden are separate keys; hiding one leaves the other shown', () => {
    const s = memory();
    expect([loadDivergencesHidden(s), loadDivergencesHidden(s, 'hidden')]).toEqual([false, false]);
    saveDivergencesHidden(s, true, 'hidden');
    expect(s.m.get(HIDDEN_DIVERGENCES_HIDDEN_KEY)).toBe('1');
    expect(s.m.has(DIVERGENCES_HIDDEN_KEY)).toBe(false);
    expect([loadDivergencesHidden(s, 'regular'), loadDivergencesHidden(s, 'hidden')]).toEqual([false, true]);
    saveDivergencesHidden(s, true); // the default is the regular switch, as before IB-144
    expect(s.m.get(DIVERGENCES_HIDDEN_KEY)).toBe('1');
    expect(HIDDEN_DIVERGENCES_HIDDEN_KEY).not.toBe(DIVERGENCES_HIDDEN_KEY);
  });
  it('a store that throws or is missing: shown, and saving does not throw', () => {
    expect(loadDivergencesHidden(throwing, 'hidden')).toBe(false);
    expect(() => saveDivergencesHidden(throwing, true, 'hidden')).not.toThrow();
    expect(loadDivergencesHidden(null, 'hidden')).toBe(false);
  });
});

describe('layer switches (IB-129) — one remembered pref per kind, independent, shown by default', () => {
  it('each layer has its own key; hiding one leaves the others shown, and the choice comes back', () => {
    const s = memory();
    for (const l of CHART_LAYERS) expect(loadLayerHidden(s, l)).toBe(false);
    saveLayerHidden(s, 'fundingAlerts', true);
    expect(CHART_LAYERS.filter((l) => loadLayerHidden(s, l))).toEqual(['fundingAlerts']);
    expect(new Set(CHART_LAYERS.map(layerHiddenKey)).size).toBe(CHART_LAYERS.length);
    expect(CHART_LAYERS.map(layerHiddenKey)).not.toContain(DIVERGENCES_HIDDEN_KEY);
    saveLayerHidden(s, 'fundingAlerts', false);
    expect(loadLayerHidden(s, 'fundingAlerts')).toBe(false);
  });
  it('a store that throws or is missing: shown, and saving does not throw', () => {
    expect(loadLayerHidden(throwing, 'liqAlerts')).toBe(false);
    expect(() => saveLayerHidden(throwing, 'liqAlerts', true)).not.toThrow();
    expect(loadLayerHidden(null, 'liqAlerts')).toBe(false);
  });
});

describe('phone layers fold (IB-129 review) — closed by default, the opened state remembered', () => {
  it('closed until opened; open comes back; closing again is remembered too', () => {
    const s = memory();
    expect(loadPhoneLayersOpen(s)).toBe(false);
    savePhoneLayersOpen(s, true);
    expect(s.m.get(PHONE_LAYERS_OPEN_KEY)).toBe('1');
    expect(loadPhoneLayersOpen(s)).toBe(true);
    savePhoneLayersOpen(s, false);
    expect(loadPhoneLayersOpen(s)).toBe(false);
  });
  it('a store that throws or is missing: closed, and saving does not throw', () => {
    expect(loadPhoneLayersOpen(throwing)).toBe(false);
    expect(() => savePhoneLayersOpen(throwing, true)).not.toThrow();
    expect(loadPhoneLayersOpen(null)).toBe(false);
  });
});
