import {
  OI_DIVERGENCE_DEFAULT_PARAMS, OI_DIVERGENCE_TF_SEC, OI_DIVERGENCE_TFS, OiDivergenceParamsSchema, WebAlertSymbolSchema,
  WebOiDivergenceAlertSchema, WebOiDivergenceLineSchema, WebOiDivergenceSeriesResponseSchema,
} from '../src/insight';

/** IB-109 — the divergence contracts: the defaults are valid, and each guard refuses what it should. */
const point = (time: number, price: number, oi: number) => ({ time, price, oiTime: time, oi });
const line = {
  direction: 'bullish', a: point(1_793_700_000, 100, 1_000), b: point(1_793_790_000, 98, 1_050),
  confirmedAt: 1_793_811_600, pricePct: -2, oiPct: 5, repeat: null, firedAt: null,
};

describe('OI divergence contracts (IB-109)', () => {
  it('the V5–V7 defaults parse: N 6, k 3, W 96/120/90, δp 0.25 × ATR, δoi 0.5 × median', () => {
    expect(OiDivergenceParamsSchema.parse(OI_DIVERGENCE_DEFAULT_PARAMS)).toEqual({
      perTf: { '15m': { n: 6, k: 3, w: 96 }, '1h': { n: 6, k: 3, w: 120 }, '4h': { n: 6, k: 3, w: 90 } },
      atrMult: 0.25, oiMedianMult: 0.5,
    });
    expect(OI_DIVERGENCE_TFS.map((tf) => OI_DIVERGENCE_TF_SEC[tf])).toEqual([900, 3_600, 14_400]);
  });

  it('a line parses; a repeat must say a run of at least 3 pivots', () => {
    expect(WebOiDivergenceLineSchema.safeParse(line).success).toBe(true);
    expect(WebOiDivergenceLineSchema.safeParse({ ...line, repeat: { runLength: 3, firstBTime: 1_793_790_000 } }).success).toBe(true);
    expect(WebOiDivergenceLineSchema.safeParse({ ...line, repeat: { runLength: 2, firstBTime: 1_793_790_000 } }).success).toBe(false);
    expect(WebOiDivergenceLineSchema.safeParse({ ...line, direction: 'up' }).success).toBe(false);
    const { firedAt: _dropped, ...without } = line;
    expect(WebOiDivergenceLineSchema.safeParse(without).success).toBe(false); // «not sent» is stated, not omitted
  });

  it('a series response carries its params, lines and skips; a TF outside 15m/1h/4h is refused', () => {
    const res = { symbol: 'TRXUSDT', tf: '1h', from: 1_791_000_000, to: 1_793_900_000, params: OI_DIVERGENCE_DEFAULT_PARAMS, lines: [line],
      skips: [{ barTime: 1_793_000_000, reason: 'no_oi_data', holeFrom: 1_792_990_000, holeTo: 1_792_990_300 }] };
    expect(WebOiDivergenceSeriesResponseSchema.safeParse(res).success).toBe(true);
    expect(WebOiDivergenceSeriesResponseSchema.safeParse({ ...res, tf: '5m' }).success).toBe(false);
  });

  it('a journal row: run length ≥ 2, params kept with it; an alert symbol is a venue symbol, not a base', () => {
    const row = { id: 1, symbol: 'BTCUSDT', tf: '15m', direction: 'bearish', a: line.a, b: line.b, runOf: null, runLength: 2,
      params: OI_DIVERGENCE_DEFAULT_PARAMS, confirmedAt: 1, firedAt: null, late: true, recipients: 0,
      priceAtFire: null, price4h: null, price24h: null, outcomeAt: null };
    expect(WebOiDivergenceAlertSchema.safeParse(row).success).toBe(true);
    expect(WebOiDivergenceAlertSchema.safeParse({ ...row, runLength: 1 }).success).toBe(false);
    expect(WebAlertSymbolSchema.safeParse({ symbol: 'TRXUSDT', base: 'TRX', enabled: true, addedAt: 1, addedBy: null }).success).toBe(true);
    expect(WebAlertSymbolSchema.safeParse({ symbol: 'trx/usdt', base: 'TRX', enabled: true, addedAt: 1, addedBy: null }).success).toBe(false);
  });
});
