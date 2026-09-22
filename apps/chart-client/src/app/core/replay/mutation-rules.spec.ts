import { ApiError } from '../api/api-error';
import { advanceTarget, backoffMs, coalesceHead, isRejection, isRetryable, isTerminal, type MutationInput } from './mutation-rules';

const adv = (m: number): MutationInput => ({ kind: 'advance', toCursorMs: m * 60_000 });
const cancel: MutationInput = { kind: 'cancel', cursorMs: 0, orderId: 'o1' };

describe('coalesceHead (§5.5)', () => {
  it('merges the advances at the head into one with the latest target', () => {
    expect(coalesceHead([adv(5), adv(10), adv(15)])).toEqual({ op: adv(15), consumed: 3 });
  });

  it('never merges across an order op', () => {
    expect(coalesceHead([adv(5), adv(10), cancel, adv(15), adv(20)])).toEqual({ op: adv(10), consumed: 2 });
    expect(coalesceHead([cancel, adv(15)])).toEqual({ op: cancel, consumed: 1 });
  });

  it('is null for an empty queue', () => {
    expect(coalesceHead([])).toBeNull();
  });
});

describe('advanceTarget', () => {
  it('keeps a minute-aligned target and rounds anything else up', () => {
    expect(advanceTarget(300_000)).toBe(300_000);
    expect(advanceTarget(300_001)).toBe(360_000);
  });
});

describe('isRetryable', () => {
  it('retries network errors and 5xx only', () => {
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryable(new ApiError(503, null, 'x'))).toBe(true);
    expect(isRetryable(new ApiError(409, 'CURSOR_BACKWARDS', 'x'))).toBe(false);
    expect(isRetryable(new ApiError(400, null, 'x'))).toBe(false);
  });
});

describe('backoffMs', () => {
  it('doubles from 250 ms and caps at 8 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([250, 500, 1000, 2000, 4000, 8000, 8000]);
  });
});

describe('isRejection (T-023)', () => {
  const place: MutationInput = { kind: 'place', cursorMs: 0, panelId: 'p', side: 'long', type: 'market', sl: 1, riskPct: 1 };
  it('only a 422 on place: every other 4xx, and a 422 on anything else, is still a refusal', () => {
    expect(isRejection(new ApiError(422, 'SL_ON_WRONG_SIDE', 'x'), place)).toBe(true);
    expect(isRejection(new ApiError(409, 'CURSOR_MISMATCH', 'x'), place)).toBe(false);
    expect(isRejection(new ApiError(422, 'NO_PRICE_AT_CURSOR', 'x'), { kind: 'close', cursorMs: 0, orderId: 'o' })).toBe(false);
    expect(isRejection(new ApiError(422, 'SL_ON_WRONG_SIDE', 'x'), { kind: 'modify', cursorMs: 0, orderId: 'o', sl: 1 })).toBe(true); // T-033
    expect(isRejection(new ApiError(409, 'ORDER_NOT_ACTIVE', 'x'), { kind: 'modify', cursorMs: 0, orderId: 'o', sl: 1 })).toBe(false);
    expect(isRejection(new TypeError('Failed to fetch'), place)).toBe(false);
  });

  it('T-059: a 422 VALUE_OUT_OF_RANGE is never a rejection, not even on place or modify', () => {
    const overflow = new ApiError(422, 'VALUE_OUT_OF_RANGE', 'x');
    expect(isRejection(overflow, place)).toBe(false);
    expect(isRejection(overflow, { kind: 'modify', cursorMs: 0, orderId: 'o', sl: 1 })).toBe(false);
  });
});

describe('isTerminal (T-059)', () => {
  it('only VALUE_OUT_OF_RANGE: not retried (a 4xx), and final for the session', () => {
    const overflow = new ApiError(422, 'VALUE_OUT_OF_RANGE', 'values must stay below 1e12');
    expect(isTerminal(overflow)).toBe(true);
    expect(isRetryable(overflow)).toBe(false);
    expect(isTerminal(new ApiError(422, 'SL_ON_WRONG_SIDE', 'x'))).toBe(false);
    expect(isTerminal(new ApiError(500, null, 'numeric field overflow'))).toBe(false);
    expect(isTerminal(new TypeError('Failed to fetch'))).toBe(false);
  });
});
