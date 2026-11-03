import type { BinanceRestKline } from '@trade-automation/binance-client';

/**
 * IB-006 — the REST mechanics both Binance collectors share: one `GET` with a timeout, the
 * `x-mbx-used-weight-1m` header reported back, and a thrown error carrying the status.
 *
 * **Only the mechanics are shared, never the budget.** USD-M (`fapi`) and spot (`api`) are metered
 * separately by the venue — 2400/min and 6000/min (design §4.5) — so each subclass reports its
 * weight through its own `onWeight`, into its own gauge. Adding a spot number to the futures gauge
 * would give a dashboard a figure that cannot be compared with its own ceiling.
 */

import { globalFetch, responseText, type FetchLike } from '../fetch-like';

/** WD-008: one `FetchLike` for every venue client (`venues/fetch-like.ts`); re-exported for old importers. */
export type { FetchLike };

export interface BinanceRestOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
  /** Called with the venue's used-weight header value after every answered request. */
  onWeight?: (usedWeight1m: number) => void;
  /** Request timeout; a hung REST call must not stall the degraded poller. */
  timeoutMs?: number;
}

export const DEFAULT_REST_TIMEOUT_MS = 10_000;

/**
 * Binance's documented error code for an unknown symbol: HTTP 400 with `{"code":-1121,"msg":"Invalid
 * symbol."}`. The shape is pinned by test/fixtures/binance/fapi-klines-invalid-symbol.json (one live
 * probe, 2026-11-03, `/fapi/v1/klines?symbol=NOPEXYZUSDT`).
 */
export const BINANCE_INVALID_SYMBOL = -1121;

/**
 * A non-2xx answer, with the venue's own error code when the body carries one. The message keeps the
 * old `Binance REST <path> failed: <status> <text>` prefix and appends the code.
 */
export class BinanceRestError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    statusText: string,
    /** Binance's `code` from the error body, or null when the body had none (a proxy's 502, say). */
    readonly venueCode: number | null,
    venueMessage: string | null,
  ) {
    super(
      `Binance REST ${path} failed: ${status} ${statusText}` +
        (venueCode !== null ? ` (code ${venueCode}${venueMessage ? `: ${venueMessage}` : ''})` : ''),
    );
  }
}

/** Reads `{code, msg}` off an error body; anything else (HTML, empty, junk) is no code. */
export function parseBinanceErrorBody(body: string): { code: number | null; msg: string | null } {
  try {
    const parsed = JSON.parse(body) as { code?: unknown; msg?: unknown };
    const code = typeof parsed.code === 'number' && Number.isInteger(parsed.code) ? parsed.code : null;
    return { code, msg: typeof parsed.msg === 'string' ? parsed.msg : null };
  } catch {
    return { code: null, msg: null };
  }
}

/** True only for the venue saying it does not know the symbol: 400 AND code -1121, never any 400. */
export function isInvalidSymbol(error: unknown): boolean {
  return error instanceof BinanceRestError && error.status === 400 && error.venueCode === BINANCE_INVALID_SYMBOL;
}

export abstract class BinanceRest {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(protected readonly options: BinanceRestOptions) {
    this.fetchImpl = options.fetchImpl ?? globalFetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REST_TIMEOUT_MS;
  }

  protected async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, { signal: controller.signal });
      const used = Number(response.headers.get('x-mbx-used-weight-1m'));
      if (Number.isFinite(used) && used > 0) this.options.onWeight?.(used);
      if (!response.ok) {
        const body = parseBinanceErrorBody(await responseText(response).catch(() => ''));
        throw new BinanceRestError(path, response.status, response.statusText, body.code, body.msg);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The last `limit` 1m klines of one symbol; the path differs per market (fapi vs api). */
  abstract klines(symbol: string, limit?: number): Promise<BinanceRestKline[]>;
}
