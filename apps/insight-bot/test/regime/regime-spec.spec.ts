import { readSourceTree, stripComments } from '../helpers/source-scan';
import { join } from 'node:path';
import { REGIME_SPEC, REGIME_VERSION, regimeParamNumber, regimeSpecFingerprint } from '../../src/regime/regime-spec';
import { WEB_FEATURE_UNAVAILABLE } from '@trade-automation/contracts';

/**
 * IB-016 — the guards around the axes: the meaning fingerprint, the vocabulary copy that has to
 * go, and §8.3's structural rule that `playbooks/` may never read `regime/`.
 */

describe('the regime spec fingerprint', () => {
  /**
   * Changing a band edge, a lookback, a window or an axis's `def` moves this. When it moves, the
   * question is not "update the literal" — it is "does `REGIME_VERSION` need to go up?", because
   * stored context rows carry the version they were computed under and a silently redefined axis
   * makes every comparison across the change a lie.
   */
  it('matches the committed literal, so a change of meaning cannot pass unnoticed', () => {
    expect(regimeSpecFingerprint()).toBe('50d155b8');
    expect(REGIME_VERSION).toBe(1);
  });

  it('moves when a band edge moves — the whole point of pinning it', () => {
    const tweaked = {
      ...REGIME_SPEC,
      vol: { ...REGIME_SPEC.vol, params: { ...REGIME_SPEC.vol.params, highBand: 0.85 } },
    } as Record<string, { def: string; params: Record<string, string | number> }>;
    expect(regimeSpecFingerprint(tweaked)).not.toBe(regimeSpecFingerprint());
  });

  it('moves when a definition is reworded, because the words are the meaning', () => {
    const tweaked = {
      ...REGIME_SPEC,
      leverage: { ...REGIME_SPEC.leverage, def: 'something else entirely' },
    } as Record<string, { def: string; params: Record<string, string | number> }>;
    expect(regimeSpecFingerprint(tweaked)).not.toBe(regimeSpecFingerprint());
  });

  it('refuses to invent a missing constant', () => {
    expect(() => regimeParamNumber('vol', 'nonexistent')).toThrow(/no numeric param/);
    expect(regimeParamNumber('vol', 'highBand')).toBe(0.8);
  });

  it('keeps one pair of percentile bands across vol and leverage', () => {
    // two pairs would drift apart for no stated reason; if they are ever meant to differ, that is
    // a ruling and this spec is where it gets argued
    expect(REGIME_SPEC.leverage.params.lowBand).toBe(REGIME_SPEC.vol.params.lowBand);
    expect(REGIME_SPEC.leverage.params.highBand).toBe(REGIME_SPEC.vol.params.highBand);
  });
});

describe('the refusal vocabulary', () => {
  it('is the contract’s, now that IB-015 is on master — there is no second copy to drift', () => {
    // this file used to assert that a local copy of WEB_FEATURE_UNAVAILABLE had not drifted from
    // the contract, because the contract lived on an unmerged branch. The copy is deleted; the
    // axes import the real union, so a reason that does not exist no longer compiles.
    expect(WEB_FEATURE_UNAVAILABLE).toContain('insufficient_history');
    expect(WEB_FEATURE_UNAVAILABLE).toContain('incomplete_input');
  });
});

/**
 * §8.3's structural constraint, as a spec rather than a guideline: context may enter a decision
 * **only** through IB-017's declared `context_gate` and the global veto. A playbook that imports
 * `regime/` has bypassed both, and the whole point of the two-arm design — that a gate's own
 * expectancy is measurable — is gone with it.
 *
 * Written **before** `src/playbooks/` existed, when it passed vacuously, because a guard that
 * arrives after the directory it guards arrives after the first import it was meant to stop.
 * IB-017 has since landed and it now scans real files — so it also asserts that it **found** some,
 * because a guard that silently scans an empty directory (a rename, a moved tree) proves nothing
 * while still showing green.
 *
 * **Verified by planting the violation** (2026-10-12), the way dev-3 verified the migration-version
 * guard: adding `import { evaluateRegimeGate } from '../regime/gate';` to `src/playbooks/gate.ts`
 * failed this spec and named that file; the import was then removed. A guard nobody has watched
 * fail is a guard nobody knows the shape of.
 */
describe('playbooks/ must never import regime/', () => {
  const srcDir = join(process.cwd(), 'src');
  const playbooksDir = join(srcDir, 'playbooks');

  /** Static `from '…'`, `require('…')` and dynamic `import('…')` — all three reach the same code. */
  const IMPORTS_REGIME = [
    /from\s+['"][^'"]*regime[^'"]*['"]/,
    /require\(\s*['"][^'"]*regime[^'"]*['"]/,
    /import\(\s*['"][^'"]*regime[^'"]*['"]/,
  ];

  it('holds for every file in playbooks/, and says how many it read', () => {
    // the shared scanner (test/helpers/source-scan.ts) brings both properties this guard needs and
    // only had one of: it THROWS rather than returning [] — this spec's own lesson, after an import
    // guard passed vacuously over an empty directory — and it STRIPS COMMENTS, which this guard
    // never did, so a comment mentioning `from '../regime/axes'` used to be able to fail it
    const files = readSourceTree(playbooksDir, { skipSpecs: false });
    expect(files.length).toBeGreaterThan(0);

    const offenders = files
      .filter((file) => IMPORTS_REGIME.some((pattern) => pattern.test(file.code)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('does not fail on a comment that merely MENTIONS the forbidden import', () => {
    // the half this guard was missing: prose about a boundary is not a breach of it
    const commented = stripComments("// import { volAxis } from '../regime/axes';\nconst x = 1;");
    expect(IMPORTS_REGIME.some((pattern) => pattern.test(commented))).toBe(false);
    // and the real import still trips it, so the stripping has not disarmed the guard
    expect(IMPORTS_REGIME.some((p) => p.test("import { volAxis } from '../regime/axes';"))).toBe(true);
  });

  it('catches every import form, not just the static one', () => {
    const forms = [
      "import { volAxis } from '../regime/axes';",
      "const { volAxis } = require('../regime/axes');",
      "const m = await import('../regime/axes');",
    ];
    for (const line of forms) {
      expect(IMPORTS_REGIME.some((pattern) => pattern.test(line))).toBe(true);
    }
    expect(IMPORTS_REGIME.some((pattern) => pattern.test("import { x } from './config';"))).toBe(false);
  });
});
