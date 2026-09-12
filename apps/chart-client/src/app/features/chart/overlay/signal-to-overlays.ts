import type { OverlayPrimitive, Signal, StrategyTier } from '@trade-automation/contracts';

/** architecture/vwap-band-reversal-plugin.md §6 — amber is reserved for research tier. */
export const RESEARCH_TIER_COLOR = '#d29922';

const DIRECTION_SHAPE: Record<Signal['direction'], OverlayPrimitive & { type: 'marker' }> = {
  long: { type: 'marker', time: 0, position: 'below', shape: 'arrowUp', color: '#26a69a' },
  short: { type: 'marker', time: 0, position: 'above', shape: 'arrowDown', color: '#ef5350' },
  flat: { type: 'marker', time: 0, position: 'above', shape: 'circle', color: '#787b86' },
};

/**
 * Tier-aware fallback colour for a signal's default marker (§6 item 3): a
 * research-tier signal is always amber with `research` marker text, so even
 * a strategy that forgets to supply its own overlay cannot be mistaken for
 * a real trading signal. 'demo'/'live' keep the direction-based colouring.
 */
function fallbackMarker(signal: Signal): OverlayPrimitive & { type: 'marker' } {
  const template = DIRECTION_SHAPE[signal.direction];
  if (signal.tier === 'research') {
    return { ...template, color: RESEARCH_TIER_COLOR, text: 'research' };
  }
  return { ...template, text: signal.strategyId };
}

/**
 * Signal[] → OverlayPrimitive[] (§5.2 of live-signal-server.md; §6 of
 * vwap-band-reversal-plugin.md): flattens each signal's own overlay
 * primitives, and synthesizes a tier-aware default marker for a signal that
 * declares none — so every signal is visible, and every research-tier
 * signal reads as research even without a strategy-supplied overlay.
 */
export function signalsToOverlays(signals: readonly Signal[]): OverlayPrimitive[] {
  const overlays: OverlayPrimitive[] = [];
  for (const signal of signals) {
    if (signal.overlay.length > 0) {
      overlays.push(...signal.overlay);
    } else {
      overlays.push({ ...fallbackMarker(signal), time: signal.time });
    }
  }
  return overlays;
}

export function isResearchTier(tier: StrategyTier): boolean {
  return tier === 'research';
}
