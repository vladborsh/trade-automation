import { LIQ_MERGE_RATIO, LIQ_MERGE_SEC, LIQ_SMALL_MULT } from '@trade-automation/contracts';
import { MERGE_MS, absorbedAfter, holdDecision, isSmall, opensDuringHold, takes } from '../../../src/alerts/liquidations/merge';

/** IB-148 (§2b, L16–L18) — the merge decisions, pure: each boundary on both sides of its edge. */
const S = 1_000;
const T = Date.UTC(2026, 10, 6, 12, 0, 0);

describe('merge rulings (L16)', () => {
  it('constants: small < 3 × own threshold, taken in at ≥ 10 ×, window 120 s', () => {
    expect([LIQ_SMALL_MULT, LIQ_MERGE_RATIO, LIQ_MERGE_SEC, MERGE_MS]).toEqual([3, 10, 120, 120_000]);
  });

  it('small: ONE member, strictly below 3 × its own threshold', () => {
    expect(isSmall([{ sumUsd: 899_999, thresholdUsd: 300_000 }])).toBe(true);
    expect(isSmall([{ sumUsd: 900_000, thresholdUsd: 300_000 }])).toBe(false); // exactly 3 ×: not small
    expect(isSmall([{ sumUsd: 6e6, thresholdUsd: 5e6 }])).toBe(true); // coin-relative: a $6M BTC is small
    expect(isSmall([{ sumUsd: 4e5, thresholdUsd: 3e5 }, { sumUsd: 1e6, thresholdUsd: 1e6 }])).toBe(false); // two members
    expect(isSmall([])).toBe(false);
  });

  it('takes: at least 10 × the small sum', () => {
    expect(takes(4e6, 4e5)).toBe(true); // exactly 10 ×
    expect(takes(3_999_999, 4e5)).toBe(false);
  });
});

describe('L17: absorbed after a large close', () => {
  const large = { t0: T - 5 * 60 * S, closeAt: T, totalUsd: 30e6 };

  it('T0 at most 120 s after the close, inclusive; 121 s is not', () => {
    expect(absorbedAfter(T + 120 * S, 4e5, [large])).toBe(large);
    expect(absorbedAfter(T + 120 * S + 1, 4e5, [large])).toBeNull();
    expect(absorbedAfter(T, 4e5, [large])).toBe(large);
  });

  it('not by an event below 10 ×, not by a later one, not by itself', () => {
    expect(absorbedAfter(T + 60 * S, 4e5, [{ ...large, totalUsd: 3.9e6 }])).toBeNull();
    expect(absorbedAfter(T + 60 * S, 4e5, [{ t0: T + 60 * S, closeAt: T + 60 * S, totalUsd: 30e6 }])).toBeNull();
    expect(absorbedAfter(T - 1, 4e5, [large])).toBeNull(); // T0 before the close would have joined it (L11)
  });

  it('the latest qualifying close wins', () => {
    const later = { t0: T - 60 * S, closeAt: T + 30 * S, totalUsd: 10e6 };
    expect(absorbedAfter(T + 90 * S, 4e5, [large, later])).toBe(later);
  });
});

describe('L18: the hold of a small event', () => {
  const sAt = T;

  it('opens during the hold: T0 in (S, S + 120 s]', () => {
    expect(opensDuringHold(sAt, sAt)).toBe(false);
    expect(opensDuringHold(sAt, sAt + 1)).toBe(true);
    expect(opensDuringHold(sAt, sAt + 120 * S)).toBe(true);
    expect(opensDuringHold(sAt, sAt + 120 * S + 1)).toBe(false);
  });

  it('nothing opened: wait until S + 120 s, then send, due at S + 120 s', () => {
    expect(holdDecision(sAt, 4e5, null, sAt + 119 * S)).toEqual({ kind: 'wait' });
    expect(holdDecision(sAt, 4e5, null, sAt + 120 * S)).toEqual({ kind: 'send', dueAt: sAt + 120 * S });
    expect(holdDecision(sAt, 4e5, null, sAt + 125 * S)).toEqual({ kind: 'send', dueAt: sAt + 120 * S });
  });

  it('something opened: wait for its S (past the hold), then fold in at ≥ 10 ×, else send due at its S', () => {
    const next = { t0: sAt + 100 * S, sAt: null, totalUsd: null, written: false };
    expect(holdDecision(sAt, 4e5, next, sAt + 250 * S)).toEqual({ kind: 'wait' });
    expect(holdDecision(sAt, 4e5, { ...next, sAt: sAt + 280 * S, totalUsd: 4e6 }, sAt + 280 * S)).toEqual({ kind: 'fold', into: sAt + 100 * S });
    expect(holdDecision(sAt, 4e5, { ...next, sAt: sAt + 280 * S, totalUsd: 3.9e6 }, sAt + 280 * S)).toEqual({ kind: 'send', dueAt: sAt + 280 * S });
  });

  it('the next event\'s first message already written (a failed tick in between): sent, not folded into a sent text', () => {
    expect(holdDecision(sAt, 4e5, { t0: sAt + 100 * S, sAt: sAt + 200 * S, totalUsd: 40e6, written: true }, sAt + 210 * S)).toEqual({ kind: 'send', dueAt: sAt + 200 * S });
  });
});
