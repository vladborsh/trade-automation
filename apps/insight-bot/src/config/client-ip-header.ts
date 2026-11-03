/**
 * `CLIENT_IP_HEADER` (IB-078 H6) → the header name to read, lower-cased as Node stores incoming
 * header names, or `undefined` when unset or blank. On the box the value is `x-real-ip`, which
 * Caddy sets, overwriting any client copy, on every request it proxies.
 *
 * This is the one reading of the variable, and two places depend on it:
 * - the login throttle and journal take the client address from this header (`web-auth.service.ts`);
 * - WD-011 H7: `/metrics` answers 404 to any request that CARRIES this header, because only a
 *   request that came through the proxy, from outside the box, carries it (`metrics.controller.ts`).
 *
 * Both must agree on what "configured" means, or `/metrics` could be open while the throttle
 * believes it is behind the proxy.
 */
export function clientIpHeaderName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const name = raw.trim().toLowerCase();
  return name.length > 0 ? name : undefined;
}
