/**
 * IB-012 — fetching and unzipping one archive file (§5).
 *
 * The distinction this module exists to make: **404 is an answer, not a failure.** The archive
 * simply does not have every month of every series (no metrics before a symbol's floor, no
 * monthly file for the current month), and a backfill that retried or recorded those as errors
 * would either waste the budget or poison the coverage report. A 404 comes back as
 * `{ kind: 'absent' }`; only transport and server errors are retried.
 */

import { unzipSync } from 'fflate';

export type ArchiveFetch =
  | { kind: 'ok'; text: string; bytes: number }
  | { kind: 'absent' };

export interface ArchiveClientOptions {
  /** Injected in specs; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  retries?: number;
  /** Base for exponential backoff between retries. */
  retryBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_TIMEOUT_MS = 120_000;

export class ArchiveHttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`archive HTTP ${status} for ${url}`);
  }
}

/** Unzips a single-entry archive zip and returns its text. */
export function unzipSingle(data: Uint8Array): string {
  const files = unzipSync(data);
  const names = Object.keys(files);
  if (names.length === 0) throw new Error('empty zip');
  // every data.binance.vision zip holds exactly one CSV; if that changes, take the only .csv
  const name = names.length === 1 ? names[0] : (names.find((n) => n.toLowerCase().endsWith('.csv')) ?? names[0]);
  return new TextDecoder().decode(files[name] as Uint8Array);
}

export class ArchiveClient {
  private readonly fetchImpl: typeof fetch;
  private readonly retries: number;
  private readonly retryBaseMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ArchiveClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Downloads and unzips one file. Retries transport and 5xx; never retries a 404. */
  async get(url: string): Promise<ArchiveFetch> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await this.sleep(this.retryBaseMs * 2 ** (attempt - 1));
      try {
        const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
        if (response.status === 404) return { kind: 'absent' };
        if (!response.ok) throw new ArchiveHttpError(response.status, url);
        const buffer = new Uint8Array(await response.arrayBuffer());
        return { kind: 'ok', text: unzipSingle(buffer), bytes: buffer.byteLength };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

/**
 * Runs `task` over `items` with at most `limit` in flight (§5: ≤ 4 parallel downloads).
 * Results come back in the input's order, so a caller can write months in sequence.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}
