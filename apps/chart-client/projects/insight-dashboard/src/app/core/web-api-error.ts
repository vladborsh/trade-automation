import { WebErrorSchema, type WebErrorCode } from '@trade-automation/contracts';
import { ApiError } from '@backtest-core/api/api-error';

/**
 * IB-030 — the `/api/web` error body, which is **not** the backtest envelope.
 *
 * The backtest app answers `{ error: { code, message } }` with `BacktestErrorCode`; every
 * `/api/web` endpoint answers a flat `{ code, message?, maxDays? }` with `WebErrorCode` (IB-031
 * landed the shared shape). So `toApiError` cannot read this body — it would return `code: null`
 * for every failure, and a page branching on the code would silently take its fallback path
 * forever. Hence a parser of our own, throwing the same shared `ApiError` class with this app's
 * code set.
 *
 * `maxDays` is kept on the message when present: it rides on `RANGE_TOO_WIDE` so a caller can
 * retry with a correct window instead of guessing.
 */
export function toWebApiError(method: string, path: string, status: number, body: unknown): ApiError<WebErrorCode> {
  const parsed = WebErrorSchema.safeParse(body);
  if (!parsed.success) {
    return new ApiError<WebErrorCode>(status, null, `${method} ${path} failed: HTTP ${status}`);
  }
  const { code, message, maxDays } = parsed.data;
  const detail = maxDays === undefined ? '' : ` (at most ${maxDays} days)`;
  return new ApiError<WebErrorCode>(status, code, `${message ?? `${method} ${path} failed: ${code}`}${detail}`);
}
