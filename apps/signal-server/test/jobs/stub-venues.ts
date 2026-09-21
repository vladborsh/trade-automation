import * as http from 'http';
import { AddressInfo } from 'net';

const MIN = 60_000;

/**
 * T-031 — loopback stand-ins for the two venues' REST endpoints the backfill uses, so the real
 * `BinanceAdapter` / `CapitalComAdapter` run against them (the network guard allows loopback; no
 * spec reaches a venue). One synthetic bar per minute: Binance from `listingMs`, Capital.com from
 * `floorMs` (a 404 for a window ending before it, as the venue does below its retention). Every
 * request is recorded.
 */
export interface StubVenueServer {
  url: string;
  requests: { path: string; query: Record<string, string> }[];
  close(): Promise<void>;
}

export interface StubVenueOptions {
  /** Binance: no klines before this. */
  listingMs?: number;
  /** Capital.com: 404 for a window ending before this; bars from it on. */
  floorMs?: number;
  /** Bars stop at this minute (the "now" of the stub). */
  lastMs: number;
}

export async function startStubVenue(options: StubVenueOptions): Promise<StubVenueServer> {
  const requests: StubVenueServer['requests'] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub');
    const query = Object.fromEntries(url.searchParams.entries());
    requests.push({ path: url.pathname, query });
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/fapi/v1/klines') {
      const from = Math.max(Number(query.startTime), options.listingMs ?? Number.NEGATIVE_INFINITY);
      const to = Math.min(Number(query.endTime), options.lastMs);
      const rows: unknown[] = [];
      for (let t = Math.ceil(from / MIN) * MIN; t <= to && rows.length < Number(query.limit); t += MIN) {
        const p = String(100 + (t / MIN) % 1000);
        rows.push([t, p, p, p, p, '1', t + MIN - 1, '0', 1, '0', '0', '0']);
      }
      return json(200, rows);
    }
    if (url.pathname === '/api/v1/session' && req.method === 'POST') {
      return json(200, {}, { cst: 'stub-cst', 'x-security-token': 'stub-token' });
    }
    if (url.pathname.startsWith('/api/v1/prices/')) {
      const from = Date.parse(`${query.from}Z`);
      const to = Math.min(Date.parse(`${query.to}Z`), options.lastMs);
      if (options.floorMs !== undefined && Date.parse(`${query.to}Z`) < options.floorMs) {
        return json(404, { errorCode: 'error.prices.not-found' });
      }
      const prices: unknown[] = [];
      for (let t = Math.max(from, options.floorMs ?? from); t <= to && prices.length < Number(query.max); t += MIN) {
        const p = { bid: 1.1, ask: 1.1002 };
        const iso = new Date(t).toISOString().slice(0, 19);
        prices.push({ snapshotTime: iso, snapshotTimeUTC: iso, openPrice: p, closePrice: p, highPrice: p, lowPrice: p, lastTradedVolume: 1 });
      }
      return json(200, { prices, instrumentType: 'CURRENCIES' });
    }
    json(404, { error: 'stub: unknown path' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
