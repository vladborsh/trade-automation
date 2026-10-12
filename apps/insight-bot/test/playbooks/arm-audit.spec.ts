import type { WebFeatureFrame } from '@trade-automation/contracts';
import { armKeyVerdicts } from '../../src/playbooks/arm-audit.cli';

const frame = (keys: Record<string, unknown>): WebFeatureFrame => ({ keys } as unknown as WebFeatureFrame);

describe('armKeyVerdicts', () => {
  it('reports EVERY refusing key, not just the first', () => {
    // reporting only the first would make the audit a function of key ORDER, and the count of
    // reasons — the number that says when a playbook can first arm — would be wrong invisibly
    const verdicts = armKeyVerdicts(
      frame({ a: { ok: false, why: 'no_data' }, b: { ok: true, value: 1 }, c: { ok: false, why: 'incomplete_input' } }),
      ['a', 'b', 'c'],
    );
    expect(verdicts.filter((v) => !v.ok).map((v) => `${v.key}:${v.why}`)).toEqual(['a:no_data', 'c:incomplete_input']);
  });

  it('distinguishes a key that REFUSED from one the frame does not carry at all', () => {
    // `absent` is a key the registry does not have yet (px.high before dev-2 adds it); a refusal
    // is a key that exists and could not be computed. Folding them together would hide which of
    // the two is blocking a playbook, and only one of them is anybody's fault.
    const verdicts = armKeyVerdicts(frame({ present: { ok: false, why: 'no_data' } }), ['present', 'missing']);
    expect(verdicts).toEqual([
      { key: 'present', ok: false, why: 'no_data' },
      { key: 'missing', ok: false, why: 'absent' },
    ]);
  });

  it('says nothing is refusing when every key is available', () => {
    expect(armKeyVerdicts(frame({ a: { ok: true, value: 0 } }), ['a']).every((v) => v.ok)).toBe(true);
  });
});
