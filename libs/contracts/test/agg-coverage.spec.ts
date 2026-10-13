import { WebAggCoverageSchema, WebCoverageResponseSchema } from '../src/insight/coverage';

/**
 * IB-056 — the aggregate-coverage block of `GET /api/web/coverage`.
 *
 * About the shape carrying its meaning, not the arithmetic: the counts are produced and tested in
 * `apps/insight-bot`, against a real database. What matters here is that `market` cannot be
 * dropped, and that adding the block did not break a client built against the earlier response.
 */
describe('WebAggCoverageSchema', () => {
  const row = {
    symbol: 'ETHUSDT',
    market: 'spot',
    tf: '15m',
    held: 573,
    derivable: 6358,
    unfetchable: 2,
    oldestDerivable: Date.UTC(2026, 7, 1),
  };

  it('parses a series with a derivable backlog', () => {
    expect(WebAggCoverageSchema.parse(row)).toEqual(row);
  });

  it('requires `market`: a symbol alone names two series, and collapsing them halves every count', () => {
    const { market: _market, ...withoutMarket } = row;
    expect(() => WebAggCoverageSchema.parse(withoutMarket)).toThrow();
  });

  it('allows a null oldest bucket, and does not accept 0 as a stand-in for it', () => {
    expect(WebAggCoverageSchema.parse({ ...row, derivable: 0, oldestDerivable: null }).oldestDerivable).toBeNull();
    // 0 is a real instant (1970) and must stay distinguishable from "there is no gap".
    expect(WebAggCoverageSchema.parse({ ...row, oldestDerivable: 0 }).oldestDerivable).toBe(0);
  });

  it('keeps the three counts separate, because they call for three different responses', () => {
    const parsed = WebAggCoverageSchema.parse(row);
    expect([parsed.held, parsed.derivable, parsed.unfetchable]).toEqual([573, 6358, 2]);
  });
});

describe('WebCoverageResponseSchema with the aggregate block', () => {
  it('defaults `agg` to empty, so a client built before IB-056 keeps parsing', () => {
    const parsed = WebCoverageResponseSchema.parse({ rows: [] });
    expect(parsed.agg).toEqual([]);
    expect(parsed.windowDays).toBe(30);
  });

  it('carries the block through when the server sends it', () => {
    const parsed = WebCoverageResponseSchema.parse({
      rows: [],
      agg: [
        {
          symbol: 'BTCUSDT',
          market: 'perp',
          tf: '1d',
          held: 71,
          derivable: 0,
          unfetchable: 0,
          oldestDerivable: null,
        },
      ],
    });
    expect(parsed.agg).toHaveLength(1);
    expect(parsed.agg[0].market).toBe('perp');
  });
});
