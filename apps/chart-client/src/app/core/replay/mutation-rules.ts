import { isApiError } from '../api/api-error';

const ONE_MINUTE_MS = 60_000;

/** What the client asks the server to do (backtest-app-system-design.md §5.5, §7.2). */
export type MutationInput =
  | { kind: 'advance'; toCursorMs: number }
  | { kind: 'place'; cursorMs: number; panelId: string; side: 'long' | 'short'; type: 'market' | 'limit'; limitPrice?: number; sl: number; tp?: number; riskPct: number }
  | { kind: 'cancel'; cursorMs: number; orderId: string }
  | { kind: 'close'; cursorMs: number; orderId: string }
  | { kind: 'modify'; cursorMs: number; orderId: string; sl?: number; tp?: number };

export type AdvanceInput = Extract<MutationInput, { kind: 'advance' }>;

/**
 * §5.5 coalescing: the advances waiting at the head of the queue become one, with the latest
 * target (the server walks the whole span either way). Stops at the first order op — an order op
 * is never reordered relative to the advances around it, so advances after it stay separate.
 * Returns how many queued items the head op consumes.
 */
export function coalesceHead(queue: readonly MutationInput[]): { op: MutationInput; consumed: number } | null {
  if (queue.length === 0) return null;
  const head = queue[0];
  if (head.kind !== 'advance') return { op: head, consumed: 1 };
  let target = head.toCursorMs;
  let consumed = 1;
  while (consumed < queue.length && queue[consumed].kind === 'advance') {
    target = Math.max(target, (queue[consumed] as AdvanceInput).toCursorMs);
    consumed++;
  }
  return { op: { kind: 'advance', toCursorMs: target }, consumed };
}

/**
 * The server takes minute-aligned targets only (400 otherwise) and clamps one past the period
 * end. Every bar close is already on a minute; rounding up turns a period end that is not (the
 * API does not require one) into a clamped, completing request instead of a 400.
 */
export function advanceTarget(toCursorMs: number): number {
  return Math.ceil(toCursorMs / ONE_MINUTE_MS) * ONE_MINUTE_MS;
}

/** Only a network failure or a 5xx is worth resending; a 4xx is an answer (and never changes). */
export function isRetryable(err: unknown): boolean {
  return isApiError(err) ? err.status >= 500 : true;
}

/**
 * T-023: a 422 on `place` is the server validating an order (a level on the wrong side, a stop too
 * close, …) — an answer about that one request, not a sign the client's state diverged. The queue
 * reports it and carries on; nothing is reloaded. Every other 4xx still stops the queue (§5.5).
 */
export function isRejection(err: unknown, op: MutationInput): boolean {
  return op.kind === 'place' && isApiError(err, 422);
}

/** Capped exponential backoff: 250 ms, 500, 1 s, 2 s, 4 s, then 8 s for every further attempt. */
export function backoffMs(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 8_000);
}
