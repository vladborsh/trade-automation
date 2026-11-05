import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OI_DIVERGENCE_DEFAULT_PARAMS } from '@trade-automation/contracts';
import { detectDivergences, type Bar } from '../../../src/insights/divergence/detector';
import { detectorParams } from '../../../src/insights/divergence/params';

/**
 * IB-141 option 1, on the real case V39 found: BNBUSDT 4h, B 2026-10-27 12:00 (bearish). Under 6/2 B paired with an
 * OI pivot 3 bars before it (10-27 00:00, OI 560 301 < A's 561 271), while B's own bar already had an OI max above
 * A's (566 688): the alert said «OI did not follow» when it had. Bars from the venue, OI from the box's own rows.
 * The fixture ends at B + 2, the bars the loop had when it judged B: one bar later an OI pivot at B + 1 is confirmed
 * and becomes the nearer pairing (which is how the pairing already behaves at 6/6 too).
 */
interface Fixture {
  bars: Bar[];
  oi5m: Array<{ time: number; oi: number }>;
  tfSec: number;
  expected: { direction: string; aTime: number; bTime: number; bOiBarTime: number };
}
const F: Fixture = JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'binance', 'oi-divergence-bnbusdt-4h-oi-before-b.json'), 'utf8'));
const P62 = detectorParams(OI_DIVERGENCE_DEFAULT_PARAMS, '4h');
const atB = (r: ReturnType<typeof detectDivergences>) => r.divergences.filter((d) => d.b.time === F.expected.bTime).map((d) => [d.direction, d.a.time]);

describe('option 1 on the BNB 4h case (V39)', () => {
  const bIndex = F.bars.findIndex((b) => b.time === F.expected.bTime);
  const oiIndex = F.bars.findIndex((b) => b.time === F.expected.bOiBarTime);

  it('the defaults are 6/2 on 4h, and B pairs with the OI pivot 3 bars before it', () => {
    expect([P62.nLeft, P62.nRight, P62.k]).toEqual([6, 2, 3]);
    const r = detectDivergences({ tfSec: F.tfSec, bars: F.bars, oi5m: F.oi5m, params: P62 });
    expect(r.pairs.find((p) => p.side === 'high' && p.price === bIndex)?.oi).toBe(oiIndex);
    expect(bIndex - oiIndex).toBe(3);
  });

  it('no alert at that B: its OI pivot does not stand on B’s own bar', () => {
    expect(atB(detectDivergences({ tfSec: F.tfSec, bars: F.bars, oi5m: F.oi5m, params: P62 }))).toEqual([]);
  });

  it('control: B’s bar capped at the OI pivot’s level, the V39 alert (A 10-23 12:00) is back — so the rule is what refused it', () => {
    const bOpen = F.expected.bTime;
    const pivotMax = Math.max(...F.oi5m.filter((o) => o.time > F.expected.bOiBarTime && o.time <= F.expected.bOiBarTime + F.tfSec).map((o) => o.oi));
    const capped = F.oi5m.map((o) => (o.time > bOpen && o.time <= bOpen + F.tfSec ? { ...o, oi: Math.min(o.oi, pivotMax) } : o));
    expect(atB(detectDivergences({ tfSec: F.tfSec, bars: F.bars, oi5m: capped, params: P62 }))).toEqual([['bearish', F.expected.aTime]]);
  });
});
