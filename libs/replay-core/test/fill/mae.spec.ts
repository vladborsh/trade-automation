import { computeMae } from '../../src/fill';
import { MAE_FIXTURES } from '../../src/fixtures';

describe('computeMae — §6 "MAE" (decision 26)', () => {
  it.each(MAE_FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    const r = computeMae(f.order, f.path);
    expect(r.maePrice).toBeCloseTo(f.expected.maePrice, 9);
    expect(r.maeR).toBeCloseTo(f.expected.maeR, 9);
  });

  it('refuses a trade that has not closed', () => {
    const f = MAE_FIXTURES[0];
    expect(() => computeMae({ ...f.order, exitTimeMs: null }, f.path)).toThrow(/exitTimeMs/);
  });
});
