/**
 * The insight bot's web contracts (IB-029 onwards). Separate from the backtest app's barrel:
 * same repository, same patterns, different product.
 *
 * Owned by dev-3 for IB-029; other dashboard tasks append their own modules here.
 */
export * from './common';
export * from './auth';
// IB-030 — the dashboard's health and coverage surfaces.
export * from './health';
export * from './coverage';
// IB-031 — the instrument view.
export * from './series';
export * from './universe';
// IB-037 — the market-context page (Fear & Greed, dominance, top-20 caps).
export * from './context';
