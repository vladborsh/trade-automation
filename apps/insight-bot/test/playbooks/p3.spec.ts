import { canArm, type WebFeatureFrame, type WebFeatureValue } from '@trade-automation/contracts';
import {
  drawdownIsAtLeastAtrs, high24hFrom, p3, p3ArmConditions, p3Invalidated, p3Setup, parseP3Params,
  type P3Params,
} from '../../src/playbooks/p3';

/**
 * IB-018 — P3 on hand-built frames with the arithmetic written out.
 *
 * The cascade below is one worked example used throughout, so a level can be checked by hand:
 * a 15m bar with high 100, low 90, close 91, ATR(1h) 2, drawdown −9.09 % from a 24 h high of 100.1.
 */

const PARAMS: P3Params = {
  liqZMin: 3,
  oiDropPctBySymbol: { BTCUSDT: -8, ETHUSDT: -12, SOLUSDT: -12 },
  predictedFundingMax: 0.0001,
  drawdownAtrMultiple: 2.5,
  triggerAtrMultiple: 0.5,
  stopAtrMultiple: 0.1,
  t1RangeFraction: 0.5,
  armedTtlBars: 8,
};

const ok = (value: number): WebFeatureValue => ({ ok: true, value });
const refused = (why: 'no_data' | 'insufficient_history'): WebFeatureValue => ({ ok: false, why });

/** A cascade frame: every arm condition satisfied unless a test overrides one. */
function frame(overrides: Record<string, WebFeatureValue> = {}): WebFeatureFrame {
  return {
    symbol: 'BTCUSDT',
    tf: '15m',
    closeTime: 1_790_000_000,
    frameVersion: 1,
    keys: {
      'liq.long.z60m': ok(4.2),
      'oi.d4h_pct': ok(-9),
      'funding.predicted.binance': ok(0.00005),
      'px.drawdown_from_24h_high': ok(-9.0909),
      'atr.1h.14': ok(2),
      'px.close': ok(91),
      'px.high': ok(100),
      'px.low': ok(90),
      ...overrides,
    },
    basis: { venues: ['binance'], coverage: 'recorded', coveredHours: 24 },
    complete: false,
    incompleteReason: [],
    revision: 1,
    amendedAt: null,
    amendedKeys: [],
    computedMode: 'live',
    computedAt: 1_790_000_100,
  } as WebFeatureFrame;
}

describe('P3 arming', () => {
  it('arms when all four §9.1 conditions pass', () => {
    const { conditions, pass } = p3ArmConditions({ symbol: 'BTCUSDT', frame: frame(), params: PARAMS });
    expect(pass).toBe(true);
    expect(conditions.map((c) => c.key)).toEqual([
      'liq.long.z60m', 'oi.d4h_pct', 'funding.predicted.binance', 'px.drawdown_from_24h_high',
    ]);
  });

  it('CANNOT arm while the liquidation z-score refuses — the normal state on this tape', () => {
    // §9.1: "until 14 days of liquidation history exist liq.*.z60m is null and P3 cannot arm — by
    // design". Both halves are checked: the condition fails, and canArm refuses before evaluate()
    // is ever called, so the playbook is not asked to read a refusal as a value.
    const f = frame({ 'liq.long.z60m': refused('insufficient_history') });
    expect(p3ArmConditions({ symbol: 'BTCUSDT', frame: f, params: PARAMS }).pass).toBe(false);
    expect(canArm(f, [...p3.keys.armKeys])).toBe(false);
  });

  it('cannot arm for a symbol with no configured OI threshold, and says which', () => {
    // no fallback: BTC's −8 % on an altcoin whose ordinary 4h move is twice that would arm on noise
    const { conditions, pass } = p3ArmConditions({ symbol: 'DOGEUSDT', frame: frame(), params: PARAMS });
    expect(pass).toBe(false);
    const oi = conditions.find((c) => c.key === 'oi.d4h_pct');
    expect(oi).toMatchObject({ pass: false, threshold: 'no threshold configured for DOGEUSDT' });
  });

  it('applies the per-symbol threshold: −9 % arms BTC and does not arm ETH', () => {
    expect(p3ArmConditions({ symbol: 'BTCUSDT', frame: frame(), params: PARAMS }).pass).toBe(true);
    const eth = p3ArmConditions({ symbol: 'ETHUSDT', frame: frame({ 'px.close': ok(91) }), params: PARAMS });
    expect(eth.conditions.find((c) => c.key === 'oi.d4h_pct')).toMatchObject({ threshold: -12, pass: false });
  });

  it('refuses a frame whose keys are present but refusing, rather than treating them as zero', () => {
    for (const key of ['oi.d4h_pct', 'funding.predicted.binance', 'atr.1h.14', 'px.close']) {
      const f = frame({ [key]: refused('no_data') });
      expect(p3ArmConditions({ symbol: 'BTCUSDT', frame: f, params: PARAMS }).pass).toBe(false);
    }
  });
});

describe('the drawdown condition, as price distances', () => {
  it('reconstructs the 24 h high from the stored percentage', () => {
    // close 91 at −9.0909 % → high = 91 / (1 − 0.090909) = 100.1
    expect(high24hFrom(91, -9.0909)).toBeCloseTo(100.1, 3);
  });

  it('compares two price distances, so no denominator is involved', () => {
    // high − close = 100.1 − 91 = 9.1; 2.5 × ATR(2) = 5 → deep enough
    expect(drawdownIsAtLeastAtrs(91, -9.0909, 2, 2.5)).toBe(true);
    // a 1 % drawdown is 0.92 against 5 → not deep
    expect(drawdownIsAtLeastAtrs(91, -1, 2, 2.5)).toBe(false);
  });

  it('sits exactly on the boundary where the distance equals the ATR multiple', () => {
    // close 95 at −5 % → high exactly 100, distance exactly 5.0, threshold 2.5×2 = 5 → passes
    expect(drawdownIsAtLeastAtrs(95, -5, 2, 2.5)).toBe(true);
    // just under: −4.99 % → high 99.9895, distance 4.9895
    expect(drawdownIsAtLeastAtrs(95, -4.99, 2, 2.5)).toBe(false);
    // NOT by nudging the close: the drawdown is a PERCENTAGE, so a higher close at the same
    // percentage implies a proportionally higher 24 h high and the distance grows with it
    // (95.01 at −5 % is a distance of 5.0005, still over). The first version of this fixture
    // moved the close and expected a fail; the fixture was wrong, not the rule.
    expect(drawdownIsAtLeastAtrs(95.01, -5, 2, 2.5)).toBe(true);
  });

  it('refuses an impossible drawdown rather than inventing a level from it', () => {
    // ≤ −100 % implies a non-positive 24 h high; a stop and a target built on it would be fiction
    expect(high24hFrom(91, -100)).toBeNull();
    expect(drawdownIsAtLeastAtrs(91, -120, 2, 2.5)).toBeNull();
  });
});

describe('the setup P3 holds', () => {
  const setup = p3Setup({ armId: 'a1', closeTime: 1_790_000_000_000, frame: frame(), params: PARAMS })!;

  it('triggers at the LOWER of the midpoint and low + 0.5 ATR', () => {
    // midpoint (100+90)/2 = 95; low + 0.5×2 = 91 → the setup waits for 91, not 95, or it would
    // sit past its own trigger
    expect(setup.trigger).toEqual({ type: 'close_above', level: 91, tf: '15m' });
  });

  it('stops below the cascade low by the ATR fraction', () => {
    expect(setup.stop).toBeCloseTo(90 - 0.1 * 2, 10); // 89.8
  });

  it('targets half the cascade range, then the 24 h high', () => {
    expect(setup.targets[0]).toBeCloseTo(90 + 0.5 * (100 - 90), 10); // 95
    expect(setup.targets[1]).toBeCloseTo(100.1, 3); // T2 = the 24 h high, ruled 2026-10-12
  });

  it('expires after armed_ttl_bars of 15m', () => {
    expect(setup.expiresAt).toBe(1_790_000_000 + 8 * 15 * 60);
  });

  it('carries machine-readable invalidation rules rather than prose', () => {
    expect(setup.invalidation).toEqual([
      { key: 'px.low', op: '<', value: 90 },
      { key: 'oi.d4h_pct', op: '>', value: 0 },
    ]);
  });

  it('is null when a level it needs refuses — never a setup with a guessed level', () => {
    expect(p3Setup({ armId: 'a', closeTime: 1, frame: frame({ 'px.low': refused('no_data') }), params: PARAMS })).toBeNull();
    expect(p3Setup({ armId: 'a', closeTime: 1, frame: frame({ 'px.high': refused('no_data') }), params: PARAMS })).toBeNull();
  });
});

describe('P3 through the state machine’s eyes', () => {
  const armed = p3.evaluate({
    symbol: 'BTCUSDT', tf: '15m', closeTime: 1_790_000_000_000, frame: frame(),
    prev: 'IDLE', setup: null, params: PARAMS as unknown as Record<string, unknown>,
  });

  it('wants to arm on the cascade bar and hands over the setup', () => {
    expect(armed.wantsArm).toBe(true);
    expect(armed.setup?.trigger.level).toBe(91);
    expect(armed.triggered).toBe(false);
  });

  it('ARMED → TRIGGERED when a 15m close reaches the trigger level', () => {
    const next = p3.evaluate({
      symbol: 'BTCUSDT', tf: '15m', closeTime: 1_790_000_900_000,
      frame: frame({ 'px.close': ok(91.5), 'px.low': ok(90.5) }),
      prev: 'ARMED', setup: armed.setup!, params: PARAMS as unknown as Record<string, unknown>,
    });
    expect(next.triggered).toBe(true);
    expect(next.invalidated).toBe(false);
  });

  it('does not trigger on a close below the level', () => {
    const next = p3.evaluate({
      symbol: 'BTCUSDT', tf: '15m', closeTime: 1_790_000_900_000,
      frame: frame({ 'px.close': ok(90.9) }),
      prev: 'ARMED', setup: armed.setup!, params: PARAMS as unknown as Record<string, unknown>,
    });
    expect(next.triggered).toBe(false);
  });

  it('invalidates on OI rising while price is still below the trigger', () => {
    // positions rebuilt into weakness is the opposite of the exhaustion P3 fades
    expect(p3Invalidated({
      frame: frame({ 'oi.d4h_pct': ok(1.5), 'px.close': ok(90.2) }),
      setup: armed.setup!, prev: 'ARMED',
    })).toBe(true);
  });

  it('invalidates on a new low after the trigger', () => {
    expect(p3Invalidated({
      frame: frame({ 'px.low': ok(89), 'px.close': ok(92), 'oi.d4h_pct': ok(-9) }),
      setup: armed.setup!, prev: 'TRIGGERED',
    })).toBe(true);
  });

  it('returns NULL — not false — when the invalidation cannot be evaluated', () => {
    // oi.d4h_pct is in triggerKeys precisely so the runner reports blind_while_armed; a `false`
    // here would be the system saying "not invalidated" while holding a live setup it cannot see
    expect(p3Invalidated({
      frame: frame({ 'oi.d4h_pct': refused('no_data') }),
      setup: armed.setup!, prev: 'ARMED',
    })).toBeNull();
    expect(canArm(frame({ 'oi.d4h_pct': refused('no_data') }), [...p3.keys.triggerKeys])).toBe(false);
  });
});

describe('P3 params', () => {
  it('throws on a missing threshold rather than defaulting one', () => {
    const { liqZMin, ...withoutLiqZ } = PARAMS;
    expect(() => parseP3Params(withoutLiqZ as unknown as Record<string, unknown>)).toThrow(/not usable/);
    expect(liqZMin).toBe(3);
  });

  it('accepts the v1 configuration', () => {
    expect(parseP3Params(PARAMS as unknown as Record<string, unknown>)).toMatchObject({ liqZMin: 3, armedTtlBars: 8 });
  });
});
