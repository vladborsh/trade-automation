import { ApiError } from '../api/api-error';
import { advanceTarget, backoffMs, coalesceHead, isRetryable, type MutationInput } from './mutation-rules';

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
