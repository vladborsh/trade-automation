import { canonicalJson, opFingerprint } from '../../src/backtest/op-fingerprint';

describe('canonicalJson / opFingerprint (BUG-004)', () => {
  it('canonicalJson sorts keys recursively, keeps array order, drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
    expect(canonicalJson({ n: 0.1 + 0.2 })).toBe('{"n":0.30000000000000004}'); // numbers as JSON prints them
  });

  it('key order does not matter, including a nested costs-like object', () => {
    const a = { opId: 'x', toCursorMs: 5, costs: { enabled: true, commissionPct: 0.04, spread: 1 } };
    const b = { costs: { spread: 1, enabled: true, commissionPct: 0.04 }, toCursorMs: 5, opId: 'x' };
    expect(opFingerprint('advance', a)).toBe(opFingerprint('advance', b));
  });

  it('the opId is excluded; kind, body and target order all count', () => {
    const req = { opId: 'first', cursorMs: 10 };
    expect(opFingerprint('cancel', req, 'o1')).toBe(opFingerprint('cancel', { ...req, opId: 'other' }, 'o1'));
    expect(opFingerprint('cancel', req, 'o1')).not.toBe(opFingerprint('close', req, 'o1'));
    expect(opFingerprint('cancel', req, 'o1')).not.toBe(opFingerprint('cancel', req, 'o2'));
    expect(opFingerprint('cancel', req, 'o1')).not.toBe(opFingerprint('cancel', { ...req, cursorMs: 11 }, 'o1'));
    expect(opFingerprint('advance', { toCursorMs: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
