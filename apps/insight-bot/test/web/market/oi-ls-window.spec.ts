import { RETENTION_MS } from '../../../src/venues/binance/futures-data.client';
import { MAX_ROWS, clipToRetention, periodFor } from '../../../src/web/market/oi-ls-window';

const H = 3_600_000;
const D = 24 * H;

describe('periodFor (WD-008)', () => {
  it.each([
    [D, '5m'], // 288 rows
    [3 * D, '5m'], // 864
    [7 * D, '15m'], // 672
    [30 * D, '1h'], // 720
    [90 * D, '4h'], // 540 — wider than the venue keeps, but the helper does not know that
  ])('a %d ms window reads at %s', (span, period) => {
    expect(periodFor(0, span).period).toBe(period);
  });

  it('never needs more than MAX_ROWS rows (two 500-row pages) up to a 1d period', () => {
    for (const span of [H, D, 4 * D, 10 * D, 30 * D, 120 * D, 900 * D]) {
      const { periodMs } = periodFor(0, span);
      expect(Math.ceil(span / periodMs)).toBeLessThanOrEqual(MAX_ROWS);
    }
  });
});

describe('clipToRetention (WD-008)', () => {
  const now = 100 * D;
  const edge = now - RETENTION_MS;

  it('leaves a window inside retention alone', () => {
    expect(clipToRetention(now - D, now, now)).toEqual({ fromMs: now - D, toMs: now, clipped: false, empty: false });
  });

  it('moves an older `from` forward to the edge and says so', () => {
    expect(clipToRetention(now - 45 * D, now, now)).toEqual({ fromMs: edge, toMs: now, clipped: true, empty: false });
  });

  it('marks a window wholly before the edge as empty — nothing to ask the venue for', () => {
    expect(clipToRetention(now - 60 * D, now - 40 * D, now)).toMatchObject({ clipped: true, empty: true, fromMs: edge });
  });
});

describe('IB-080 joinAtBoundary', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { joinAtBoundary } = require('../../../src/web/market/oi-ls-window');
  const p = (time: number, v: number) => ({ time, value: v });

  it('keeps stored points strictly before the boundary, then the venue — no duplicate at the boundary', () => {
    const out = joinAtBoundary([p(1, 5), p(2, 5), p(3, 5)], [p(3, 1000), p(4, 1000)], 3_000);
    expect(out).toEqual([p(1, 5), p(2, 5), p(3, 1000), p(4, 1000)]);
  });

  it('drops stored points inside the venue range even when they disagree — the venue wins', () => {
    expect(joinAtBoundary([p(5, 9)], [p(3, 1000), p(6, 1000)], 3_000)).toEqual([p(3, 1000), p(6, 1000)]);
  });
});

describe('IB-118: periodFor with a floor', () => {
  const H = 3_600_000;
  it('7 days with no floor is 15 m (672 rows); with a 1 h floor, 1 h (168 rows, one page)', () => {
    expect(periodFor(0, 7 * 24 * H).period).toBe('15m');
    expect(periodFor(0, 7 * 24 * H, H)).toEqual({ period: '1h', periodMs: H });
  });
  it('a floor never makes a window finer than its span needs: 60 days at a 1 h floor is still 2 h', () => {
    expect(periodFor(0, 60 * 24 * H, H).period).toBe(periodFor(0, 60 * 24 * H).period);
  });
});
