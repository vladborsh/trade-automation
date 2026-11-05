import { OI_DIVERGENCE_DEFAULT_PARAMS, type OiDivergenceParams } from '@trade-automation/contracts';
import { OiAlertLoop, type OiAlertLoopPorts } from '../../../src/alerts/oi-divergence/oi-alert-loop';
import { hiddenBase, input, T0, TF } from '../../insights/divergence/hidden-scene';
import { MemoryStore } from './memory-store';

/**
 * IB-144 (design V41, V42) — the hidden pair in the live loop, on a hand-built 15m scene (a hidden bullish divergence,
 * A at bar 180, B at 200, confirmed at bar 206's close): journalled always as `kind = 'hidden'`; SENT only while
 * `enabled` AND that TF's `sendHidden`; a hidden alert does not remove the pivot control at its B (controls stay «a
 * pivot with no REGULAR alert»).
 */
const A = 180;
const B = 200;
const SCENE = input(hiddenBase(A, B, 260), false, { ...input(hiddenBase(A, B, 260)).params, priceLineTolAtrMult: 0.25, oiLineTolMedianMult: 0.5 });
const CONFIRMED = T0 + (B + 6 + 1) * TF; // B's own bar holds its OI pivot: B + nRight confirms it

function withSendHidden(over: Partial<Record<'15m' | '1h' | '4h', boolean>>): OiDivergenceParams {
  const p = structuredClone(OI_DIVERGENCE_DEFAULT_PARAMS);
  for (const [tf, on] of Object.entries(over)) p.perTf[tf as '15m'].sendHidden = on as boolean;
  return p;
}

function loop(store: MemoryStore) {
  const sent: Array<{ chatId: number; text: string }> = [];
  const ports: OiAlertLoopPorts = {
    store,
    klines: async (_s, tf, from, to) => (tf === '15m' ? SCENE.bars.filter((b) => b.time >= from && b.time < to) : []),
    oiWindow: async (_s, from, to) => ({ oi5m: SCENE.oi5m.filter((o) => o.time > from && o.time <= to), venueSilent: [] }),
    closeAt: async () => 100, send: async (chatId, text) => { sent.push({ chatId, text }); return true; },
    webBaseUrl: 'https://box.example', build: 'b49cd48d4ab4', klines5m: async () => [], source: 'live',
  };
  return { loop: new OiAlertLoop(ports), sent };
}

describe('IB-144: hidden divergences in the live loop', () => {
  it('journalled as hidden whatever the switches say; enabled but sendHidden off on 15m (the default) → not sent', async () => {
    const store = new MemoryStore();
    store.settingsRow = { ...store.settingsRow, enabled: true };
    const { loop: l, sent } = loop(store);
    const r = await l.evaluate('15m', CONFIRMED, CONFIRMED + 6 * 60);
    expect(r).toMatchObject({ journalled: 1, sent: 0, late: 0 });
    expect(store.alerts.map((a) => [a.kind, a.direction, a.a.time, a.b.time, a.firedAt])).toEqual([['hidden', 'bullish', T0 + A * TF, T0 + B * TF, null]]);
    expect(sent).toEqual([]);
  });

  it('sendHidden on for 15m and enabled → sent with the hidden text; on for 1h only → still not sent on 15m; on but enabled off → not sent', async () => {
    const on = new MemoryStore();
    on.settingsRow = { ...on.settingsRow, enabled: true, params: withSendHidden({ '15m': true }) };
    const a = loop(on);
    expect((await a.loop.evaluate('15m', CONFIRMED, CONFIRMED + 6 * 60)).sent).toBe(2);
    expect(a.sent[0]?.text).toMatch(/^ETH 15m: цена — более высокий минимум \(\+2\.2 %\), OI — ниже \(−2\.1 %\)\. Позиции закрываются/);
    expect(on.alerts[0]?.firedAt).toBe(CONFIRMED + 6 * 60);

    const otherTf = new MemoryStore();
    otherTf.settingsRow = { ...otherTf.settingsRow, enabled: true, params: withSendHidden({ '1h': true }) };
    const b = loop(otherTf);
    expect((await b.loop.evaluate('15m', CONFIRMED, CONFIRMED + 6 * 60)).sent).toBe(0);

    const off = new MemoryStore();
    off.settingsRow = { ...off.settingsRow, enabled: false, params: withSendHidden({ '15m': true }) };
    const c = loop(off);
    expect((await c.loop.evaluate('15m', CONFIRMED, CONFIRMED + 6 * 60)).sent).toBe(0);
    expect(off.alerts).toHaveLength(1);
  });

  it('a hidden alert does NOT remove the pivot control at its B (V41); a regular alert there would (control)', async () => {
    // B's pivot is decided at bars.length − (k + nRight + 1): the evaluation 3 bars after the confirming one
    const decided = T0 + (B + 3 + 6 + 1) * TF;
    const store = new MemoryStore();
    const { loop: l } = loop(store);
    for (let close = CONFIRMED; close <= decided; close += TF) await l.evaluate('15m', close, close + 6 * 60);
    expect(store.alerts.map((x) => x.kind)).toEqual(['hidden']);
    expect(store.controls.filter((c) => c.kind === 'pivot' && c.barTime === T0 + B * TF).map((c) => c.direction)).toEqual(['bullish']);

    const regular = new MemoryStore();
    const { loop: l2 } = loop(regular);
    await l2.evaluate('15m', CONFIRMED, CONFIRMED + 6 * 60);
    regular.alerts[0] = { ...(regular.alerts[0] as (typeof regular.alerts)[number]), kind: 'regular' }; // as if B had a regular alert
    for (let close = CONFIRMED + TF; close <= decided; close += TF) await l2.evaluate('15m', close, close + 6 * 60);
    expect(regular.controls.filter((c) => c.kind === 'pivot' && c.barTime === T0 + B * TF)).toEqual([]);
  });
});
