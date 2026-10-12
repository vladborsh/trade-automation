import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { WEB_FRAME_VERSION, featureSpecFingerprint } from '@trade-automation/contracts';
import { fundingFeatures, type FundingInput, type Settlement } from '../../src/features/calculators/funding';

/** 8-hourly settlements ending at a fixed UTC instant — the convention the keys assume. */
const T_END = Date.UTC(2026, 9, 12, 0, 0, 0) / 1000;
const every = (rates: readonly number[], hours = 8): Settlement[] =>
  rates.map((rate, i) => ({ timeSec: T_END - (rates.length - 1 - i) * hours * 3600, rate }));

/**
 * IB-015 — the GOLDEN FRAME: one fixture, one expected output, asserted whole.
 *
 * This is criterion 5 enforced rather than described. The fingerprint catches a key or a
 * parameter changing; it cannot catch a calculator whose ARITHMETIC moved while its `def` and
 * `params` stayed put. Only a stored output can, and only if it is compared as a whole — a
 * key-by-key assertion only checks the keys someone remembered to assert.
 *
 * It grows as groups land: each new calculator adds its block to `buildGolden`, and the first
 * run after that fails until the file is regenerated and the diff is read. **Reading the diff is
 * the point.** Regenerate with `UPDATE_GOLDEN=1 npx jest test/features/golden.spec.ts`, and if
 * the change was not intended, that diff is the bug report.
 *
 * The golden is per `frame_version`, so a deliberate change of meaning bumps the version and
 * starts a new file rather than overwriting the record of the old one.
 */

const goldenPath = join(__dirname, 'golden', `frame-v${WEB_FRAME_VERSION}.json`);

/** Fixed, hand-built inputs. No clock, no database, no randomness. */
function buildGolden(): Record<string, unknown> {
  const settlements = (last: number, others: number): Settlement[] => every([
    ...Array.from({ length: 89 }, () => others),
    last,
  ]);

  /**
   * A history whose last rate sits EXACTLY on §8.2's hi threshold: 81 of 90 settlements at or
   * below it is a percentile of exactly 0.90, and the rate is exactly +0.0003.
   *
   * This fixture exists because the first golden could not see an arithmetic change. Flipping
   * `>=` to `>` in the extreme count — which no param and no `def` would reveal — left the file
   * identical, because every venue in it was comfortably inside or outside the threshold. A
   * golden whose fixture avoids the boundary tests nothing at the boundary, which is the same
   * mistake as IB-043's mid-month fixtures missing a month-boundary bug.
   */
  const exactlyOnHiThreshold = (): Settlement[] => every([
    ...Array.from({ length: 80 }, () => -0.001), // below
    ...Array.from({ length: 9 }, () => 0.001),   // above
    0.0003,                                      // the value: 81 of 90 are <= it -> pct 0.90
  ]);

  const funding: FundingInput = {
    settled: {
      binance: settlements(0.0012, -0.0001), // comfortably extreme-high
      bybit: every([0.002, 0.002, 0.002]),   // a rate, but too little history for a percentile
      okx: exactlyOnHiThreshold(),           // ON the boundary, both halves of the condition
    },
    predictedBinance: -0.000018,
  };

  return {
    frameVersion: WEB_FRAME_VERSION,
    specFingerprint: featureSpecFingerprint(),
    keys: fundingFeatures(funding),
  };
}

describe(`golden frame v${WEB_FRAME_VERSION}`, () => {
  it('matches the committed frame exactly', () => {
    const actual = buildGolden();
    if (process.env.UPDATE_GOLDEN === '1') {
      writeFileSync(goldenPath, `${JSON.stringify(actual, null, 2)}\n`);
    }
    const expected = JSON.parse(readFileSync(goldenPath, 'utf8')) as Record<string, unknown>;
    // whole-object, not key-by-key: a new key appearing with a wrong value must fail too
    expect(actual).toEqual(expected);
  });

  it('pins the fingerprint INSIDE the golden, so the two cannot drift apart', () => {
    // If someone regenerates the golden after changing a param without bumping the version,
    // the contract spec still fails on the fingerprint literal. Belt and braces, deliberately.
    const expected = JSON.parse(readFileSync(goldenPath, 'utf8')) as { specFingerprint: string };
    expect(expected.specFingerprint).toBe(featureSpecFingerprint());
  });

  it('is deterministic: the same fixture twice is byte-identical', () => {
    expect(JSON.stringify(buildGolden())).toBe(JSON.stringify(buildGolden()));
  });
});
