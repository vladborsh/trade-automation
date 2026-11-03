/**
 * IB-078 P8 as amended by architecture/https-without-domain-2026-11-03.md H6 — which address the
 * login throttle and the journal key on.
 *
 * `CLIENT_IP_HEADER` unset (every dev slot): the socket address, and any forwarding header is
 * IGNORED — reached directly, anyone can send one. Set (the box: `x-real-ip`, which Caddy
 * OVERWRITES, so a client cannot forge it): that header, exactly, by its lower-cased name; its first
 * comma-separated address, trimmed.
 *
 * Set but missing or empty: the socket address. Chosen over refusing the request because the only
 * way this happens on the box is a request that did not come through Caddy — a misconfiguration, not
 * an attack the throttle must survive — and refusing would lock everyone out of the site over a
 * proxy setting. The caller logs it once, so it is noticed rather than silently absorbed.
 */
export interface ClientIpInput {
  headers: Record<string, string | string[] | undefined>;
  socketAddress: string | undefined;
}

export interface ClientIp {
  ip: string;
  /** True when the header was configured but absent/empty and the socket address was used. */
  fellBack: boolean;
}

export function clientIp(req: ClientIpInput, headerName: string | undefined): ClientIp {
  const socket = req.socketAddress ?? 'unknown';
  if (!headerName) return { ip: socket, fellBack: false };
  const raw = req.headers[headerName.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const first = value?.split(',')[0]?.trim();
  if (!first) return { ip: socket, fellBack: true };
  return { ip: first, fellBack: false };
}
