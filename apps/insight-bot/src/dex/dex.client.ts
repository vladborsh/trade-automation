import type { Listing, Network } from './mappers';

/**
 * IB-028 — the three DEX APIs, behind one small client (§10).
 *
 * Thin by design: mapping is pure and lives elsewhere, so what is here is only how each provider
 * misbehaves. All three rates are measured, not quoted — see `README.md`.
 *
 * **A failure is returned, never thrown.** One provider being down must not stop a cycle: pool
 * snapshots are still worth collecting when GoPlus is unreachable, and the pass records what it
 * could not ask rather than discarding what it could.
 */

export const USER_AGENT = 'insight-bot/1.0 (+https://github.com/vladborsh/trade-automation; contact via repository issues)';
export const DEFAULT_TIMEOUT_MS = 20_000;

export type Fetched =
  | { ok: true; body: string; status: number }
  | { ok: false; status: number | null; reason: string };

export interface DexClientOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** GoPlus's chain ids. Solana has its own path; the EVM chains are numeric. */
export const EVM_CHAIN_IDS: Partial<Record<Network, string>> = {
  eth: '1',
  bsc: '56',
  base: '8453',
};

export class DexClient {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DexClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** GeckoTerminal: the binding constraint at ~5 requests/minute measured. */
  geckoTerminal(network: Network, listing: Listing): Promise<Fetched> {
    return this.get(`https://api.geckoterminal.com/api/v2/networks/${network}/${listing}?page=1`);
  }

  /**
   * DexScreener, BATCHED: the whole page of pool addresses in one request.
   *
   * Measured to return 20 pairs for 20 addresses, which is why this takes a list rather than an
   * address — per-pool calls would be 20x the requests for identical data.
   */
  dexScreener(network: Network, addresses: readonly string[]): Promise<Fetched> {
    if (addresses.length === 0) {
      return Promise.resolve({ ok: false, status: null, reason: 'no addresses — refusing to call with an empty batch' });
    }
    return this.get(`https://api.dexscreener.com/latest/dex/pairs/${network}/${addresses.join(',')}`);
  }

  /**
   * GoPlus, ONE TOKEN PER CALL.
   *
   * It accepts `contract_addresses=a,b,c` and returns a single result regardless — measured with
   * four verified-distinct tokens. So this takes one address and the caller pays per token; a
   * batching version would silently drop every token after the first.
   */
  goPlus(network: Network, address: string): Promise<Fetched> {
    const evm = EVM_CHAIN_IDS[network];
    const url = evm === undefined
      ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`
      : `https://api.gopluslabs.io/api/v1/token_security/${evm}?contract_addresses=${address}`;
    return this.get(url);
  }

  private async get(url: string): Promise<Fetched> {
    try {
      const response = await this.fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        // 429 is the venue saying the budget is spent, not an error to retry hard; the caller's
        // backoff treats it as a failure and widens the gap
        return { ok: false, status: response.status, reason: `HTTP ${response.status}` };
      }
      const body = await response.text();
      if (body.trim().length === 0) {
        return { ok: false, status: response.status, reason: 'empty body' };
      }
      return { ok: true, body, status: response.status };
    } catch (error) {
      const err = error as Error;
      const reason = err.name === 'TimeoutError' || err.name === 'AbortError'
        ? `timeout after ${this.timeoutMs} ms`
        : err.message;
      return { ok: false, status: null, reason };
    }
  }
}
