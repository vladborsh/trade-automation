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
// IB-120 — the /liquidations page: every large liquidation of the period, filtered.
export * from './liquidations-large';
// IB-015 — the feature frame: the key set, the per-key value type, and the arming rule.
export * from './feature-frame';
// IB-037 — the market-context page (Fear & Greed, dominance, top-20 caps).
export * from './context';
// IB-059 — the economic calendar: events on the chart, upcoming events for the alerts.
export * from './calendar';
// IB-069 — browser Web Push for the calendar reminder.
export * from './push';
// IB-087 — the market page redesign: the shared period enum and the caps block (treemap + dominance).
export * from './market';
// IB-085 — positioning table + KPI strip (design D9, D10).
export * from './market-positioning';
// IB-086 — «Главное сейчас»: rule-based statements (design D1–D5, D15).
export * from './market-insights';
// IB-035 — the admin's members page and a member's own settings (lang, calendar reminders).
export * from './members';
// IB-091 — «Деривативы и потоки»: DVOL, put/call by OI, stablecoin supply, Coinbase premium.
export * from './market-flows';
// IB-BUG-032 — one spelling of every venue and data provider, for the bot's credits and the dashboard's basis lines.
export * from './venue-names';
// IB-109 — price vs OI divergence alerts: params, chart lines, journal, admin (design V1–V17).
export * from './oi-divergence';
export * from './oi-divergence-admin';
export * from './oi-divergence-research';
