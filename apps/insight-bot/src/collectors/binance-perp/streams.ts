/**
 * IB-006 — perp-shaped, so it stayed behind when the socket moved to `binance-common`: only the
 * USD-M collector wants the two array streams beside its klines. Spot's list is just the klines
 * (`spotStreamNames`).
 */
/** The stream names for one universe: a kline per symbol plus the two array streams (§4.1). */
export function perpStreamNames(symbols: readonly string[]): string[] {
  return [...symbols.map((s) => `${s.toLowerCase()}@kline_1m`), '!markPrice@arr@1s', '!forceOrder@arr'];
}

/**
 * IB-BUG-012 — Binance split USD-M WebSocket into routed paths (`/public`, `/market`, `/private`)
 * and decommissioned the bare `fstream.binance.com/stream` and `/ws` on 2026-04-23. The legacy
 * paths still complete the handshake but carry only `/public` streams (depth, bookTicker); every
 * stream this collector wants — `kline`, `markPrice`, `forceOrder` — is a `/market` stream, so the
 * legacy socket was open and mute. Measured 2026-10-29, 10 rounds in two sessions: legacy 0 msgs,
 * `/market` flowing, legacy `depth` flowing as the control (report dev-1-ib-binance-liq-report.md).
 * https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Important-WebSocket-Change-Notice
 */
export const PERP_STREAM_ROUTE = '/market';

/**
 * The base URL the perp socket appends `/stream?streams=…` to. The route belongs to the stream
 * list above, not to the deployment, so the env var stays a host and the route is added here. A
 * host that already ends in `/market` is accepted as is; any other route (or a legacy `/ws`,
 * `/stream`) is refused, because it would open a socket that never says why it is silent.
 */
export function perpMarketWsBaseUrl(wsBaseUrl: string): string {
  const base = wsBaseUrl.replace(/\/+$/, '');
  if (base.endsWith(PERP_STREAM_ROUTE)) return base;
  const url = new URL(base);
  if (url.pathname !== '' && url.pathname !== '/') {
    throw new RangeError(
      `perpMarketWsBaseUrl: '${wsBaseUrl}' carries the path '${url.pathname}'; give the host only ` +
        `(e.g. wss://fstream.binance.com) — kline, markPrice and forceOrder live under '${PERP_STREAM_ROUTE}'`,
    );
  }
  return `${base}${PERP_STREAM_ROUTE}`;
}
