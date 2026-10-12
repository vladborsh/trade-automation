import {
  WEB_FEATURE_KEYS, WEB_FRAME_VERSION, assertSingleRevisionPerClose, latestRevisions,
  type WebFeatureFrame, type WebFeatureValue,
} from '@trade-automation/contracts';
import { applyAmendment, decideAmendment } from '../../src/features/frame-amendment';

/** IB-015 — what a re-check may and may not do to a published frame. */

const CLOSE = Date.UTC(2026, 9, 12, 12, 0, 0) / 1000;

const frame = (keys: Record<string, WebFeatureValue>, over: Partial<WebFeatureFrame> = {}): WebFeatureFrame => ({
  symbol: 'BTCUSDT', tf: '15m', closeTime: CLOSE, frameVersion: WEB_FRAME_VERSION,
  keys, basis: { venues: ['bybit'], coverage: 'not_recorded', coveredHours: null },
  complete: Object.values(keys).every((v) => v.ok), incompleteReason: [],
  revision: 1, amendedAt: null, amendedKeys: [],
  computedMode: 'live' as const, computedAt: CLOSE, ...over,
});

describe('decideAmendment', () => {
  it('IDENTICAL VALUES WRITE NOTHING — otherwise append-only becomes grows-forever', () => {
    // A duplicate revision every 30 minutes satisfies the letter of append-only and destroys the
    // property. This is §8.1's idempotency in substance.
    const published = frame({ 'oi.d24h_pct': { ok: true, value: 2 } });
    const decision = decideAmendment(published, { 'oi.d24h_pct': { ok: true, value: 2 } });
    expect(decision.action).toBe('none');
  });

  it('a repeated re-check over unchanged inputs never moves the revision', () => {
    // The spec the Tech Lead asked for, run as a loop rather than asserted once.
    let published = frame({ 'oi.d24h_pct': { ok: true, value: 2 } });
    for (let i = 0; i < 5; i += 1) {
      const decision = decideAmendment(published, { 'oi.d24h_pct': { ok: true, value: 2 } });
      expect(decision.action).toBe('none');
      if (decision.action === 'amend') published = applyAmendment(published, decision, CLOSE, [], 'live');
    }
    expect(published.revision).toBe(1);
  });

  it('promotes a refusal to a value, which is the ONLY permitted transition', () => {
    const published = frame({ 'oi.d24h_pct': { ok: false, why: 'incomplete_input' } });
    const decision = decideAmendment(published, { 'oi.d24h_pct': { ok: true, value: 2 } });
    expect(decision.action).toBe('amend');
    if (decision.action !== 'amend') return;
    expect(decision.revision).toBe(2);
    expect(decision.amendedKeys).toEqual(['oi.d24h_pct']);
    expect(decision.conflicts).toEqual([]);
  });

  it('A CHANGED PUBLISHED VALUE IS A DEFECT, NOT AN UPDATE: the old value stands', () => {
    // Something armed on the published answer. Rewriting it erases the evidence for whatever
    // that was, and an input moving under us is a finding about the collectors.
    const published = frame({ 'cvd.perp.4h': { ok: true, value: 100 } });
    const decision = decideAmendment(published, { 'cvd.perp.4h': { ok: true, value: 999 } });
    expect(decision.action).toBe('none');
    expect(decision.conflicts).toEqual([{
      key: 'cvd.perp.4h',
      published: { ok: true, value: 100 },
      recomputed: { ok: true, value: 999 },
    }]);
  });

  it('a value becoming a REFUSAL is also a defect, not an amendment', () => {
    const published = frame({ 'cvd.perp.4h': { ok: true, value: 100 } });
    const decision = decideAmendment(published, { 'cvd.perp.4h': { ok: false, why: 'no_data' } });
    expect(decision.action).toBe('none');
    expect(decision.conflicts).toHaveLength(1);
  });

  it('reports conflicts even when something else legitimately amends', () => {
    // A defect does not stop being one because another key moved in the same pass.
    const published = frame({
      'oi.d24h_pct': { ok: false, why: 'incomplete_input' },
      'cvd.perp.4h': { ok: true, value: 100 },
    });
    const decision = decideAmendment(published, {
      'oi.d24h_pct': { ok: true, value: 2 },
      'cvd.perp.4h': { ok: true, value: 999 },
    });
    expect(decision.action).toBe('amend');
    if (decision.action !== 'amend') return;
    expect(decision.amendedKeys).toEqual(['oi.d24h_pct']);
    expect(decision.conflicts.map((c) => c.key)).toEqual(['cvd.perp.4h']);
    expect(decision.keys['cvd.perp.4h']).toEqual({ ok: true, value: 100 }); // unchanged
  });

  it('a refusal changing its REASON is not an amendment', () => {
    // Still not computable: nothing a consumer could act on has changed.
    // CHANGED 2026-10-12, deliberately: leaving `incomplete_input` now amends. See the block
    // below — a stale `incomplete_input` is an unhealed-gap entry that can never be cleared.
    // Two refusals that are both something OTHER than `incomplete_input` still write nothing,
    // which is what this case now covers.
    const published = frame({ 'liq.long.z60m': { ok: false, why: 'no_data' } });
    const decision = decideAmendment(published, { 'liq.long.z60m': { ok: false, why: 'insufficient_history' } });
    expect(decision.action).toBe('none');
    expect(decision.conflicts).toEqual([]); // not a defect either — both are refusals
  });
});

describe('applyAmendment', () => {
  it('states that it was amended, when, and which keys moved', () => {
    const published = frame({
      'oi.d24h_pct': { ok: false, why: 'incomplete_input' },
      'px.ret_4h': { ok: true, value: 1 },
    });
    const decision = decideAmendment(published, { 'oi.d24h_pct': { ok: true, value: 2 } });
    if (decision.action !== 'amend') throw new Error('expected an amendment');
    const amended = applyAmendment(published, decision, CLOSE + 60, [], 'live');

    expect(amended.revision).toBe(2);
    expect(amended.amendedAt).toBe(CLOSE + 60);
    expect(amended.amendedKeys).toEqual(['oi.d24h_pct']);
    expect(amended.closeTime).toBe(CLOSE); // still that bar's decision, not the wall clock
    expect(amended.complete).toBe(true);   // the last refusal resolved
    expect(amended.incompleteReason).toEqual([]);
  });

  it('stays incomplete when something is still short', () => {
    const published = frame({
      'oi.d24h_pct': { ok: false, why: 'incomplete_input' },
      'atr.4h.14': { ok: false, why: 'incomplete_input' },
    });
    const decision = decideAmendment(published, { 'oi.d24h_pct': { ok: true, value: 2 } });
    if (decision.action !== 'amend') throw new Error('expected an amendment');
    const amended = applyAmendment(published, decision, CLOSE + 60, ['candles_agg 4h@12:00 bars 3 of 4'], 'live');
    expect(amended.complete).toBe(false);
    expect(amended.incompleteReason).toEqual(['candles_agg 4h@12:00 bars 3 of 4']);
  });
});

describe('the read rule', () => {
  it('takes the LATEST revision by default', () => {
    const r1 = frame({ a: { ok: false, why: 'incomplete_input' } });
    const r2 = frame({ a: { ok: true, value: 1 } }, { revision: 2 });
    expect(latestRevisions([r1, r2])).toHaveLength(1);
    expect(latestRevisions([r2, r1])[0].revision).toBe(2); // order of input must not matter
  });

  it('REFUSES a mix of revisions for one close_time, as it refuses a mix of versions', () => {
    const r1 = frame({ a: { ok: true, value: 1 } });
    const r2 = frame({ a: { ok: true, value: 1 } }, { revision: 2 });
    expect(() => assertSingleRevisionPerClose([r1, r2])).toThrow(/mixed frame revisions/);
    expect(() => assertSingleRevisionPerClose(latestRevisions([r1, r2]))).not.toThrow();
  });

  it('REFUSES a mix of frame_versions too', () => {
    const a = frame({ x: { ok: true, value: 1 } });
    const b = frame({ x: { ok: true, value: 1 } }, { closeTime: CLOSE + 900, frameVersion: WEB_FRAME_VERSION + 1 });
    expect(() => assertSingleRevisionPerClose([a, b])).toThrow(/mixed frame_versions/);
  });

  it('is happy with one revision each across many bars', () => {
    const frames = [0, 900, 1800].map((offset) => frame({ x: { ok: true, value: 1 } }, { closeTime: CLOSE + offset }));
    expect(() => assertSingleRevisionPerClose(frames)).not.toThrow();
    expect(latestRevisions(frames)).toHaveLength(3);
    expect(WEB_FEATURE_KEYS.length).toBeGreaterThan(0);
  });
});

/**
 * IB-015 — a chaseable refusal that turns out to be permanent.
 *
 * Found by the integration spec, not by reasoning: after a bucket healed, `symbolsAwaitingHeal`
 * kept returning the same symbol for ever. The keys had refused `incomplete_input` at revision
 * 1; once the bucket was whole they refused for their OWN reason instead, and the original rule
 * — a refusal whose reason moved writes nothing — meant the stale `incomplete_input` was what
 * every later re-check read.
 *
 * `incomplete_input` is not just a label: it is an entry in the unhealed-gap counter, a promise
 * that somebody can still fix this. Leaving it on a key that healing can never fix is an alarm
 * nobody can clear, which is the failure the permanent/chaseable split exists to prevent.
 */
describe('a chaseable refusal becoming a permanent one', () => {
  const frameWith = (why: string) => ({
    symbol: 'BTCUSDT', tf: '15m' as const, closeTime: 1_760_000_000, frameVersion: 1,
    keys: { 'px.ret_4h': { ok: false as const, why: why as never } },
    basis: { venues: [], coverage: 'not_recorded' as const, coveredHours: null },
    complete: false, incompleteReason: ['x'], revision: 1,
    amendedAt: null as number | null, amendedKeys: [] as string[],
    computedMode: 'live' as const, computedAt: 1_760_000_000,
  });

  it('AMENDS, so the unhealed-gap counter can drain', () => {
    const decision = decideAmendment(frameWith('incomplete_input'), {
      'px.ret_4h': { ok: false, why: 'no_data' },
    });
    expect(decision.action).toBe('amend');
    expect(decision.action === 'amend' && decision.amendedKeys).toEqual(['px.ret_4h']);
  });

  it('amends for insufficient_history too, not just no_data', () => {
    const decision = decideAmendment(frameWith('incomplete_input'), {
      'px.ret_4h': { ok: false, why: 'insufficient_history' },
    });
    expect(decision.action).toBe('amend');
  });

  it('does NOT amend the other way — nothing turns INTO a chaseable gap on a re-check', () => {
    // One-way, so the pair cannot oscillate and write a revision every thirty seconds.
    const decision = decideAmendment(frameWith('insufficient_history'), {
      'px.ret_4h': { ok: false, why: 'incomplete_input' },
    });
    expect(decision.action).toBe('none');
  });

  it('does NOT amend between two reasons the counter ignores', () => {
    // `no_data` -> `insufficient_history` moves nothing anybody is watching, and writing a
    // revision for it would grow the table without moving the answer.
    const decision = decideAmendment(frameWith('no_data'), {
      'px.ret_4h': { ok: false, why: 'insufficient_history' },
    });
    expect(decision.action).toBe('none');
  });

  it('changes no published VALUE, so rule 1 is intact', () => {
    // The key was refused before and is refused after: canArm answers the same either way, and
    // nothing that armed on this frame is rewritten. What changes is whether to keep waiting.
    const decision = decideAmendment(frameWith('incomplete_input'), {
      'px.ret_4h': { ok: false, why: 'no_data' },
    });
    expect(decision.action === 'amend' && decision.keys['px.ret_4h']).toEqual({ ok: false, why: 'no_data' });
    expect(decision.conflicts).toEqual([]);
  });

  it('leaves the frame incomplete — it still holds a key nobody can compute', () => {
    const published = frameWith('incomplete_input');
    const decision = decideAmendment(published, { 'px.ret_4h': { ok: false, why: 'no_data' } });
    if (decision.action !== 'amend') throw new Error('expected an amendment');
    expect(applyAmendment(published, decision, 1_760_000_100, [], 'live').complete).toBe(false);
  });
});
