/**
 * The insight bot's web contracts (IB-029 onwards). Separate from the backtest app's barrel:
 * same repository, same patterns, different product.
 *
 * Owned by dev-3 for IB-029; other dashboard tasks append their own modules here.
 */
export * from './common';
export * from './auth';
// IB-030 — the dashboard's health surface (WD-009 removed coverage).
export * from './health';
// IB-017 — the playbook port, setup state machine and twin-arm contract.
export * from './playbook';
// IB-031 — the instrument view.
export * from './series';
export * from './universe';
// IB-038 — the liquidations overview behind the landing page's card, table and feed.
export * from './liquidations-overview';
// IB-015 — the feature frame: the key set, the per-key value type, and the arming rule.
export * from './feature-frame';
// IB-037 — the market-context page (Fear & Greed, dominance, top-20 caps).
export * from './context';
// IB-059 — the economic calendar: events on the chart, upcoming events for the alerts.
export * from './calendar';
// IB-069 — browser Web Push for the calendar reminder.
export * from './push';
