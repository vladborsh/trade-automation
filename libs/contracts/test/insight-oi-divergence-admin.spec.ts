import { OI_DIVERGENCE_DEFAULT_PARAMS, WEB_ALERT_SYMBOL_REFUSALS, WebAlertSettingsPatchSchema, WebAlertSymbolAddSchema, WebAlertSymbolPatchSchema } from '../src/insight';

/** IB-112 (V17) — the admin page's writes: strict bodies, a closed list of refusals. */
describe('IB-112 admin alert writes', () => {
  it('a symbol is the venue spelling; anything else in the body is refused, not ignored', () => {
    expect(WebAlertSymbolAddSchema.safeParse({ symbol: 'TRXUSDT' }).success).toBe(true);
    expect(WebAlertSymbolAddSchema.safeParse({ symbol: 'trxusdt' }).success).toBe(false);
    expect(WebAlertSymbolAddSchema.safeParse({ symbol: 'TRX-USDT' }).success).toBe(false);
    expect(WebAlertSymbolAddSchema.safeParse({ symbol: 'TRXUSDT', enabled: true }).success).toBe(false);
  });

  it('toggling takes exactly `enabled`', () => {
    expect(WebAlertSymbolPatchSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(WebAlertSymbolPatchSchema.safeParse({ enabled: 'off' }).success).toBe(false);
    expect(WebAlertSymbolPatchSchema.safeParse({}).success).toBe(false);
  });

  it('settings: any of enabled / membersVisible / params, at least one; params are validated whole', () => {
    expect(WebAlertSettingsPatchSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(WebAlertSettingsPatchSchema.safeParse({ membersVisible: false, params: OI_DIVERGENCE_DEFAULT_PARAMS }).success).toBe(true);
    expect(WebAlertSettingsPatchSchema.safeParse({}).success).toBe(false);
    expect(WebAlertSettingsPatchSchema.safeParse({ updatedBy: 1 }).success).toBe(false);
    const badN = { ...OI_DIVERGENCE_DEFAULT_PARAMS, perTf: { ...OI_DIVERGENCE_DEFAULT_PARAMS.perTf, '1h': { n: 0, k: 3, w: 120 } } };
    expect(WebAlertSettingsPatchSchema.safeParse({ params: badN }).success).toBe(false);
  });

  it('refusals are a closed list', () => {
    expect([...WEB_ALERT_SYMBOL_REFUSALS]).toEqual(['not_found', 'not_perpetual', 'not_trading', 'already_listed', 'venue_unavailable']);
  });
});
