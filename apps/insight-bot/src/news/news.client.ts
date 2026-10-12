import type { NewsSource } from './sources';

/**
 * IB-027 — fetching one news source (§10).
 *
 * Thin on purpose: parsing is pure and lives in `parse.ts`, so everything here is about the three
 * ways a feed misbehaves rather than about its content.
 *
 * **A declared User-Agent is not optional.** SEC.gov's access policy requires a UA naming the
 * requester, and refuses anonymous automated requests — a crawler that omits it gets 403 and looks
 * like a parsing failure. The other sources do not require one, and sending it everywhere is both
 * honest and simpler than a per-source exception.
 *
 * **Redirects are per source, not a client default.** CoinDesk and Blockworks answer 308 unless
 * redirects are followed (measured 2026-09-28, recorded in `sources.ts`): a client that does not
 * follow them collects nothing from those two and looks perfectly healthy doing it.
 *
 * **A failure is returned, never thrown.** One source being down must not abort a pass that has
 * nine healthy feeds in it, so the result carries the reason and the caller decides.
 */

export const DEFAULT_TIMEOUT_MS = 20_000;

/** Named so an operator reading a venue's logs can see who we are and complain to the right place. */
export const USER_AGENT = 'insight-bot/1.0 (+https://github.com/vladborsh/trade-automation; contact via repository issues)';

export type FetchOutcome =
  | { ok: true; body: string; status: number }
  | { ok: false; status: number | null; reason: string };

export interface NewsClientOptions {
  timeoutMs?: number;
  /** Injection point for the specs; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export class NewsClient {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NewsClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchSource(source: NewsSource): Promise<FetchOutcome> {
    try {
      const response = await this.fetchImpl(source.url, {
        redirect: source.followRedirects ? 'follow' : 'manual',
        headers: {
          'user-agent': USER_AGENT,
          // some feeds serve HTML to a client that does not say what it wants
          accept: source.kind === 'json' ? 'application/json' : 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        return { ok: false, status: response.status, reason: `HTTP ${response.status}` };
      }
      const body = await response.text();
      if (body.trim().length === 0) {
        // a 200 with nothing in it is a failure that would otherwise parse to zero items and read
        // as "this source published nothing today"
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
