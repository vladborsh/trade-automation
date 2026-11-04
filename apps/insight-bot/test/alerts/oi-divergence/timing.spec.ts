import { OI_DIVERGENCE_TF_SEC } from '@trade-automation/contracts';
import { dueBarClose, isLate, nextEvaluationAt } from '../../../src/alerts/oi-divergence/timing';

/** IB-112 (V9, V10) — when the loop evaluates, and what it may still send. */
const T = Date.UTC(2026, 10, 4, 12, 0) / 1000; // a 4h, 1h and 15m boundary at once
const H = OI_DIVERGENCE_TF_SEC['1h'];

describe('evaluation time: bar close + 6 min (V9)', () => {
  it('the 12:00 close of 1h is due from 12:06:00, not a second earlier', () => {
    expect(dueBarClose(T + 6 * 60 - 1, H)).toBe(T - H);
    expect(dueBarClose(T + 6 * 60, H)).toBe(T);
    expect(dueBarClose(T + 59 * 60, H)).toBe(T);
  });
  it('per TF: 15m, 1h and 4h each by their own grid', () => {
    const now = T + 40 * 60; // 12:40
    expect(dueBarClose(now, OI_DIVERGENCE_TF_SEC['15m'])).toBe(T + 30 * 60); // 12:30 close, due 12:36
    expect(dueBarClose(now, H)).toBe(T);
    expect(dueBarClose(now, OI_DIVERGENCE_TF_SEC['4h'])).toBe(T);
  });
  it('the next evaluation is strictly after now', () => {
    expect(nextEvaluationAt(T + 6 * 60, H)).toBe(T + H + 6 * 60);
    expect(nextEvaluationAt(T + 5 * 60, H)).toBe(T + 6 * 60);
  });
});

describe('stale = late, journalled and not sent (V10: > 1 bar + 10 min)', () => {
  it('on time up to and including one bar + 10 min; late one second after', () => {
    const confirmed = T;
    expect(isLate(confirmed, T + H + 600, H)).toBe(false);
    expect(isLate(confirmed, T + H + 601, H)).toBe(true);
  });
  it('the limit scales with the TF: 25 min on 15m, 4 h 10 min on 4h', () => {
    expect(isLate(T, T + 25 * 60, OI_DIVERGENCE_TF_SEC['15m'])).toBe(false);
    expect(isLate(T, T + 25 * 60 + 1, OI_DIVERGENCE_TF_SEC['15m'])).toBe(true);
    expect(isLate(T, T + 4 * 3_600 + 600, OI_DIVERGENCE_TF_SEC['4h'])).toBe(false);
    expect(isLate(T, T + 4 * 3_600 + 601, OI_DIVERGENCE_TF_SEC['4h'])).toBe(true);
  });
  it('the box was down for hours: a 1h divergence confirmed at 03:00, evaluated at 09:06 on restart, is late', () => {
    expect(isLate(T - 9 * 3_600, T - 3 * 3_600 + 6 * 60, H)).toBe(true);
  });
  it('a normal evaluation of a just-confirmed pair is on time (confirmed at the close, evaluated 6 min later)', () => {
    expect(isLate(T, T + 6 * 60, H)).toBe(false);
  });
  it('a confirmation stamped after the evaluation (clock skew) is not late', () => {
    expect(isLate(T + 60, T, H)).toBe(false);
  });
});
