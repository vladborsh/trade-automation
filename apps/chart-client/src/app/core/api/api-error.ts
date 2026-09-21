import { BacktestErrorCodeSchema, type BacktestErrorCode } from '@trade-automation/contracts';

/**
 * A non-2xx REST response. `code` is the contract error code from the `{ error: { code,
 * message } }` envelope (backtest-app-system-design.md §7) when the body carries one, else null
 * — e.g. the auth guard's plain 401 or a validation 400.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: BacktestErrorCode | null,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Builds an ApiError from a response status and its (possibly non-JSON) parsed body. */
export function toApiError(method: string, path: string, status: number, body: unknown): ApiError {
  const envelope = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const parsed = BacktestErrorCodeSchema.safeParse(envelope?.code);
  const message = typeof envelope?.message === 'string' ? envelope.message : `${method} ${path} failed: HTTP ${status}`;
  return new ApiError(status, parsed.success ? parsed.data : null, message);
}

export function isApiError(err: unknown, status?: number): err is ApiError {
  return err instanceof ApiError && (status === undefined || err.status === status);
}

/** `base` + `path`, resolved against the page origin, with undefined params dropped. */
export function buildUrl(
  base: string,
  path: string,
  origin: string,
  params?: Record<string, string | number | undefined>,
): string {
  const url = new URL(base.replace(/\/$/, '') + path, origin);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}
