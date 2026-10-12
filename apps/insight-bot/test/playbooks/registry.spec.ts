import { STAGE_1_PLAYBOOKS, buildRegistry } from '../../src/playbooks/registry';
import { p3 } from '../../src/playbooks/p3';

describe('the stage-1 registry', () => {
  it('holds exactly P3 — one entry playbook, which is the honest state of stage 1', () => {
    // §9.4: P1/P2 closed after the squeeze gate failed, P4 is a feature with weight 0, P5's
    // trading half is not built. A registry of one is not a placeholder.
    expect([...buildRegistry().keys()]).toEqual(['P3']);
    expect(STAGE_1_PLAYBOOKS).toEqual([p3]);
  });

  it('refuses a duplicate id rather than letting the second quietly win', () => {
    // both would write signals referencing the same `playbook` string with different thresholds
    expect(() => buildRegistry([p3, { ...p3 }])).toThrow(/registered twice/);
  });

  it('registers P3 on 15m with the arm/trigger split intact', () => {
    const registered = buildRegistry().get('P3')!;
    expect(registered.tf).toBe('15m');
    expect(registered.keys.armKeys).toContain('liq.long.z60m');
    expect(registered.keys.triggerKeys).toEqual(['px.close', 'oi.d4h_pct']);
  });
});
