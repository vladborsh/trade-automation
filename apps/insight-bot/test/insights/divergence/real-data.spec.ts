import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OI_DIVERGENCE_DEFAULT_PARAMS } from '@trade-automation/contracts';
import { detectDivergences, type Bar } from '../../../src/insights/divergence/detector';
import { detectorParams } from '../../../src/insights/divergence/params';

/**
 * IB-109 — the design's positive control on real data (§3): two divergences the detector found in
 * Binance's own last 30 days (fetched 2026-11-04, 5 coins × 15m/1h/4h with the V5–V7 defaults), cut
 * with their whole lookback and the 100 bars of noise context, and committed. They must be found
 * again, A and B and both percentages.
 *
 * What it does NOT guard, measured: shifting the OI-per-bar ownership by one slot (V4) leaves both
 * results unchanged — their OI pivots are wide. That rule is pinned by `oi-per-bar.spec.ts` and by the
 * venue fixture `open-interest-hist-labels.json`, not here.
 *
 * The owner's own picture is not identified yet (coin and dates): IB-111 adds it here when it is.
 */
interface Fixture {
  symbol: string;
  tfSec: number;
  expected: { direction: 'bullish' | 'bearish'; aTime: number; bTime: number; pricePct: number; oiPct: number };
  bars: Bar[];
  oi5m: Array<{ time: number; oi: number }>;
}
const load = (name: string): Fixture => JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'binance', name), 'utf8'));
const params = detectorParams(OI_DIVERGENCE_DEFAULT_PARAMS, '1h'); // the round-2 defaults (IB-114): W 168, tolerances 0.25 / 0.5

describe.each([
  ['oi-divergence-ethusdt-1h-bullish.json', 'ETHUSDT 1h, 16.10 17:00 → 17.10 21:00: price −1.55 %, OI +0.42 %'],
  ['oi-divergence-solusdt-1h-bearish.json', 'SOLUSDT 1h, 19.10 07:00 → 20.10 14:00: price +1.88 %, OI −1.38 %'],
])('real data: %s', (file, what) => {
  it(`is detected — ${what}`, () => {
    const f = load(file);
    expect(f.bars.length).toBeGreaterThan(200); // the cut holds the lookback and the noise context
    const r = detectDivergences({ tfSec: f.tfSec, bars: f.bars, oi5m: f.oi5m, params });
    const hit = r.divergences.find((d) => d.b.time === f.expected.bTime);
    expect(hit).toBeDefined();
    expect({ direction: hit!.direction, aTime: hit!.a.time, pricePct: +hit!.pricePct.toFixed(4), oiPct: +hit!.oiPct.toFixed(4) })
      .toEqual({ direction: f.expected.direction, aTime: f.expected.aTime, pricePct: f.expected.pricePct, oiPct: f.expected.oiPct });
    expect(r.skips).toEqual([]);
  });
});
