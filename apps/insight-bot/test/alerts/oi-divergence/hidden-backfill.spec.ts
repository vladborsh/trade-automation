import { OI_DIVERGENCE_DEFAULT_PARAMS } from '@trade-automation/contracts';
import { evaluateGuard, recheck, verdictTable, type GuardInput } from '../../../src/alerts/oi-divergence/backfill/hidden-guard';
import { replayHistory, type HiddenDetection, type HistoryBackfillPorts } from '../../../src/alerts/oi-divergence/backfill/history-backfill';
import { parseKinds } from '../../../src/alerts/oi-divergence/backfill/backfill.cli';
import { hiddenBase, input, scene, T0, TF } from '../../insights/divergence/hidden-scene';
import { MemoryStore } from './memory-store';

/**
 * IB-144 (design V45, V47) — the history run for the hidden pair, and V47's guard fed by that run's own dump (the
 * composition: what the CLI writes is what the guard reads). Scenes are hand-built 15m bars (`hidden-scene.ts`), with
 * the production params (line tolerances 0.25 / 0.5).
 */
const A = 180;
const B = 200;
const LEN = 300;
const CONFIRMED = T0 + (B + 7) * TF; // the close the loop journals B at (its OI pivot on B's own bar, + nRight)
const PARAMS = { ...input(scene(1)).params, priceLineTolAtrMult: 0.25, oiLineTolMedianMult: 0.5 };

/** Hidden at B (A–B) and, on the same bars, a regular divergence at C (A′ 230 → C 250). */
const BOTH = (() => {
  const s = hiddenBase(A, B, LEN);
  s.lows[230] = 95; s.oi[231] = 960; s.lows[250] = 93; s.oi[250] = 980;
  return input(s, false, PARAMS);
})();
const CONFIRMED_C = T0 + (250 + 7) * TF;

function ports(store: MemoryStore, over: Partial<HistoryBackfillPorts> = {}, dump: HiddenDetection[] = []): HistoryBackfillPorts {
  return {
    store,
    bars: async (_s, tf, from, to) => (tf === '15m' ? BOTH.bars.filter((b) => b.time >= from && b.time < to) : []),
    oiWindow: async (_s, from, to) => ({ oi5m: BOTH.oi5m.filter((o) => o.time > from && o.time <= to), venueSilent: [] }),
    firstStoredOi: async () => T0,
    liveStart: async () => CONFIRMED_C + 3_600, // both journalling closes are inside IB-116's window
    hiddenEnd: async () => CONFIRMED_C + 3_600,
    hasLive: async (what, symbol, tf, kind, direction, bTime) => (what === 'alert' ? store.alerts : store.nearMisses)
      .some((r) => r.source === 'live' && r.symbol === symbol && r.tf === tf && r.kind === kind && r.direction === direction && r.b.time === bTime),
    build: 'b49cd48d4ab4',
    onHidden: (d) => dump.push(d),
    ...over,
  };
}

const keyed = (s: MemoryStore) => s.alerts.map((a) => [a.source, a.kind, a.b.time]);

describe('IB-144: the hidden history run', () => {
  it('both kinds (the default): regular and hidden are written; --kinds hidden: only hidden, nothing regular, no control — regular still COUNTED', async () => {
    const all = new MemoryStore();
    const r1 = await replayHistory(ports(all), CONFIRMED_C + 86_400 * 4);
    expect(keyed(all)).toEqual([['backfill', 'hidden', T0 + B * TF], ['backfill', 'regular', T0 + 250 * TF]]);
    expect(all.controls.length).toBeGreaterThan(0);

    const hidden = new MemoryStore();
    const r = await replayHistory(ports(hidden), CONFIRMED_C + 86_400 * 4, { kinds: parseKinds('hidden') });
    expect(keyed(hidden)).toEqual([['backfill', 'hidden', T0 + B * TF]]);
    expect(hidden.controls).toEqual([]);
    expect(hidden.nearMisses.every((m) => m.kind === 'hidden')).toBe(true);
    const k15 = (kind: string) => r.kinds.find((k) => k.tf === '15m' && k.kind === kind);
    expect([k15('regular')?.found, k15('regular')?.written, k15('hidden')?.found, k15('hidden')?.written]).toEqual([1, 0, 1, 1]);
    // the counts do not depend on what is written: the same as the run that writes both
    expect(r1.kinds.map((k) => [k.tf, k.kind, k.found])).toEqual(r.kinds.map((k) => [k.tf, k.kind, k.found]));
  });

  it('the hidden end is per pair: a B journalled after it is not written; a pair with no hidden-aware control writes no hidden row and is named', async () => {
    const before = new MemoryStore();
    // the hidden-aware build started 2 bars before B's journalling close: B is the live loop's, not the run's
    const r = await replayHistory(ports(before, { hiddenEnd: async () => CONFIRMED - 2 * TF + 6 * 60 + 30 }), CONFIRMED_C + 86_400, { kinds: ['hidden'] });
    expect(keyed(before)).toEqual([]);
    expect(r.kinds.find((k) => k.tf === '15m' && k.kind === 'hidden')?.found).toBe(1); // still counted for V47
    expect(r.hiddenLast['ETHUSDT 15m']).toBe(CONFIRMED - 3 * TF);

    const none = new MemoryStore();
    const r2 = await replayHistory(ports(none, { hiddenEnd: async () => null }), CONFIRMED_C + 86_400, { kinds: ['hidden'] });
    expect(keyed(none)).toEqual([]);
    expect(r2.hiddenSkipped).toEqual(['ETHUSDT 15m', 'ETHUSDT 1h', 'ETHUSDT 4h']);
  });

  it('the hidden end can lie AFTER the live start: hidden B between the two is written (not counted in the window); regular there is not', async () => {
    const store = new MemoryStore();
    const liveStart = CONFIRMED - 2 * TF + 6 * 60 + 30; // the regular live loop started before both journalling closes
    const r = await replayHistory(ports(store, { liveStart: async () => liveStart }), CONFIRMED_C + 86_400);
    expect(keyed(store)).toEqual([['backfill', 'hidden', T0 + B * TF]]);
    expect(r.kinds.find((k) => k.tf === '15m' && k.kind === 'hidden')).toMatchObject({ found: 0, written: 1 });
    expect(r.kinds.find((k) => k.tf === '15m' && k.kind === 'regular')).toMatchObject({ found: 0, written: 0 });
  });

  it('a hidden B the LIVE loop already journalled (its boot replay) is not written as backfill: one B, once', async () => {
    const store = new MemoryStore();
    await store.insertAlert({
      source: 'live', symbol: 'ETHUSDT', tf: '15m', direction: 'bullish', kind: 'hidden', a: { time: T0 + A * TF, price: 93, oiTime: 0, oi: 960 },
      b: { time: T0 + B * TF, price: 95, oiTime: 0, oi: 940 }, runOf: null, runLength: 2, params: OI_DIVERGENCE_DEFAULT_PARAMS, confirmedAt: CONFIRMED, late: true, build: 'b49cd48d4ab4',
    });
    const r = await replayHistory(ports(store), CONFIRMED_C + 86_400, { kinds: ['hidden'] });
    expect(keyed(store)).toEqual([['live', 'hidden', T0 + B * TF]]);
    expect(r.kinds.find((k) => k.tf === '15m' && k.kind === 'hidden')).toMatchObject({ found: 1, written: 0, skippedLive: 1 });
  });
});

describe('IB-144 V47: the guard, on the run’s own dump', () => {
  async function dumpOf(): Promise<{ input: GuardInput; dump: HiddenDetection[] }> {
    const dump: HiddenDetection[] = [];
    const r = await replayHistory(ports(new MemoryStore(), {}, dump), CONFIRMED_C + 86_400, { kinds: ['hidden'] });
    const regular = r.detections.filter((d) => d.kind === 'regular').map((d) => ({ tf: d.tf, symbol: d.symbol, direction: d.direction, aTime: d.aTime, bTime: d.bTime }));
    return {
      dump,
      input: { hidden: dump, detections: r.detections, kinds: r.kinds, journalRegular: regular, oiAlertUsers: 1, sendHidden: { '15m': false, '1h': false, '4h': false } },
    };
  }

  it('a clean run passes 15m (1 hidden ≤ 3 × 1 regular, the journal matches, 0 violations) and would enable exactly it; 1h / 4h have no regular → FAIL', async () => {
    const { input: g, dump } = await dumpOf();
    expect(dump).toHaveLength(1);
    expect(recheck(dump[0] as HiddenDetection)).toEqual([]);
    const v = evaluateGuard(g);
    expect(v.perTf.map((t) => [t.tf, t.pass, t.sanity.checked])).toEqual([['15m', true, 1], ['1h', false, 0], ['4h', false, 0]]);
    expect(v.enable).toEqual(['15m']);
    expect(verdictTable(v).join('\n')).toContain('| 15m | 1 | 1 | PASS (1.00) | PASS (1 / 1) | PASS (1, 0) | **PASS** | no |');
  });

  it('each check can fail: too many hidden, a regular row the dry run lost, two oi_alerts users, a TF already on', async () => {
    const { input: g } = await dumpOf();
    const kinds = g.kinds.map((k) => (k.tf === '15m' && k.kind === 'hidden' ? { ...k, found: 4 } : k));
    expect(evaluateGuard({ ...g, kinds }).perTf[0]?.rate.pass).toBe(false); // 4 > 3 × 1
    expect(evaluateGuard({ ...g, kinds: g.kinds.map((k) => (k.tf === '15m' && k.kind === 'hidden' ? { ...k, found: 3 } : k)) }).perTf[0]?.rate.pass).toBe(true);
    const extra = [...g.journalRegular, { tf: '15m' as const, symbol: 'ETHUSDT', direction: 'bearish' as const, aTime: 1, bTime: 2 }];
    expect(evaluateGuard({ ...g, journalRegular: extra }).perTf[0]?.regularUnchanged).toMatchObject({ pass: false, dry: 1, journal: 2, missing: ['ETHUSDT|bearish|1|2'] });
    expect(evaluateGuard({ ...g, oiAlertUsers: 2 }).enable).toEqual([]);
    expect(evaluateGuard({ ...g, oiAlertUsers: 0 }).enable).toEqual([]);
    expect(evaluateGuard({ ...g, sendHidden: { '15m': true, '1h': false, '4h': false } }).enable).toEqual([]);
  });

  it('the independent recheck catches a wrong sign, k, W, a line crossing on the pivot’s side, and a stated value the bars do not give', async () => {
    const { dump } = await dumpOf();
    const d = dump[0] as HiddenDetection;
    const checks = (x: HiddenDetection) => [...new Set(recheck(x).map((v) => v.check))];
    expect(checks({ ...d, b: { ...d.b, price: 92.5 }, pricePct: -0.5 })).toContain('sign');
    expect(checks({ ...d, a: { ...d.a, oiTime: d.a.time + 5 * TF } })).toContain('k');
    expect(checks({ ...d, params: { ...d.params, w: 19 } })).toEqual(['w']);
    // a wick under the rising support line by more than 0.25 × ATR14 at that bar: 93 → 95 over 20 bars is 94 at A + 10;
    // ATR14 there holds A's and A + 1's ranges (8 each) and the wick's own (9.5): 47.5 / 14 → tolerance 0.85 → 92.5 crosses
    const wick = d.bars.map((b) => (b.time === T0 + (A + 10) * TF ? { ...b, low: 92.5 } : b));
    expect(checks({ ...d, bars: wick })).toEqual(['price_line']);
    // the same wick ABOVE the line is no violation: the side is the pivot's, not the kind's
    const above = d.bars.map((b) => (b.time === T0 + (A + 10) * TF ? { ...b, low: 94.8, open: 95.8, close: 95.8, high: 96.8 } : b));
    expect(checks({ ...d, bars: above })).toEqual([]);
    // per-bar OI under the falling OI line by more than 0.5 × median (5): all three readings of bar A + 10 at 940
    const oiDip = d.oi5m.map((o) => (o.time > T0 + (A + 10) * TF && o.time <= T0 + (A + 11) * TF ? { ...o, oi: 940 } : o));
    expect(checks({ ...d, oi5m: oiDip })).toEqual(['oi_line']);
    expect(checks({ ...d, b: { ...d.b, oi: 941 }, oiPct: (941 / 960 - 1) * 100 })).toEqual(['endpoint']);
  });

  it('a hidden alert the summary counts but the dump lacks is a violation (never passed unchecked)', async () => {
    const { input: g } = await dumpOf();
    expect(evaluateGuard({ ...g, hidden: [] }).perTf[0]?.sanity).toMatchObject({ pass: false, checked: 0 });
  });

  it('--kinds parses regular / hidden and refuses anything else', () => {
    expect([parseKinds(null), parseKinds('hidden'), parseKinds('regular,hidden')]).toEqual([['regular', 'hidden'], ['hidden'], ['regular', 'hidden']]);
    expect(() => parseKinds('reverse')).toThrow(/unknown kind/);
  });
});
