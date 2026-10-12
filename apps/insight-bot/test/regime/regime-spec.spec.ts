import { readdirSync, readFileSync, statSync } from 'node:fs';
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
 * It passes vacuously today because `playbooks/` does not exist yet. That is deliberate: the
 * guard must be in place **before** the directory it guards, or it arrives after the first
 * import it was meant to stop.
 */
describe('playbooks/ must never import regime/', () => {
  const srcDir = join(process.cwd(), 'src');
  const playbooksDir = join(srcDir, 'playbooks');

  const filesUnder = (dir: string): string[] => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return [];
    }
    return entries.flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return filesUnder(path);
      return path.endsWith('.ts') ? [path] : [];
    });
  };

  it('holds for every file in playbooks/, including the ones not written yet', () => {
    const offenders = filesUnder(playbooksDir).filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /from\s+['"][^'"]*regime[^'"]*['"]/.test(source) || /require\(['"][^'"]*regime/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it('would catch an import if one appeared — the check is not vacuous by construction', () => {
    // proves the detector, not the tree: the same regex against a line that does import regime/
    const line = "import { volAxis } from '../regime/axes';";
    expect(/from\s+['"][^'"]*regime[^'"]*['"]/.test(line)).toBe(true);
  });
});
