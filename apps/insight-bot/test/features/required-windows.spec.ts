import { WEB_FEATURE_KEYS, WEB_FEATURE_SPEC } from '@trade-automation/contracts';
import {
  GROUP_LOOKBACK_MS, declaredLookbackMs, groupsFor, keyLookbackMs, keyWindowsForGroup, lookbackMs,
} from '../../src/features/required-windows';

/**
 * IB-015 — the gather windows, held to the registry.
 *
 * The failure this guards against is silent: a window one bar short does not crash, it hands a
 * calculator fewer bars than the key's definition claims and publishes the result as though the
 * period were right.
 */
describe('required windows', () => {
  it('declares a lookback for every group any key reads', () => {
    for (const group of groupsFor()) {
      expect(() => lookbackMs(group)).not.toThrow();
    }
  });

  it('has no lookback for a group no key reads — an unused window is a stale one', () => {
    expect(Object.keys(GROUP_LOOKBACK_MS).sort()).toEqual(groupsFor());
  });

  /**
   * The real assertion: every key's own parameters must fit inside the window its group is read
   * over. Widen `oi.at_7d_high` to 14 days without touching the table and this fails, naming the
   * key — rather than the page quietly showing a 7-day high computed over 7 days of a 14-day
   * question.
   */
  it('reads at least as far back as every key reading that group asks for', () => {
    const tooShort: string[] = [];
    for (const key of WEB_FEATURE_KEYS) {
      const declared = declaredLookbackMs(key);
      if (declared === null) continue;
      for (const group of WEB_FEATURE_SPEC[key].inputs) {
        if (lookbackMs(group) < declared) {
          tooShort.push(`${key} needs ${declared} ms of ${group}, table reads ${lookbackMs(group)} ms`);
        }
      }
    }
    expect(tooShort).toEqual([]);
  });

  it('gives the ATR groups period + 1 + WARM-UP bars', () => {
    // +1 because Wilder seeds from a previous close; +warmup because the recursion is only
    // reproducible over a fixed window (IB-052). A window one bar short turns a working key
    // into a permanent refusal that looks like missing data rather than a short read.
    expect(declaredLookbackMs('atr.4h.14')).toBe((15 + 56) * 4 * 3_600_000);
    expect(lookbackMs('agg:4h')).toBeGreaterThanOrEqual(declaredLookbackMs('atr.4h.14') as number);
  });

  it('counts the slope key’s previous window as well as its current one', () => {
    // cvd.perp.slope_4h compares 4 h against the PREVIOUS 4 h: reading only 4 h would make the
    // comparison a comparison with nothing.
    expect(declaredLookbackMs('cvd.perp.slope_4h')).toBe(8 * 3_600_000);
  });

  it('returns null for a key whose window is not a span', () => {
    expect(declaredLookbackMs('funding.binance.rate')).toBeNull();
    expect(declaredLookbackMs('ls.top_position')).toBeNull();
    expect(declaredLookbackMs('label.p4')).toBeNull();
  });
});

/**
 * IB-047 — the window ONE KEY needs, as distinct from the window its group is read over.
 *
 * Reading at the group's widest window was always right; judging completeness by it was the
 * defect. dev-1 measured the cost: 422 of 477 `px.*` refusals had their own 15m bar complete.
 */
const H = 3_600_000;
const M15 = 15 * 60_000;

describe('keyLookbackMs', () => {
  it('gives a frame-bar key the FRAME timeframe, not its barTf', () => {
    // px.close on a 4h frame needs the sixteen 15m bars of that bar, not one. The span comes
    // from the frame, which is why this cannot be read off the key's params alone.
    expect(keyLookbackMs('px.close', M15)).toBe(M15);
    expect(keyLookbackMs('px.close', 4 * H)).toBe(4 * H);
    expect(keyLookbackMs('px.high', 4 * H)).toBe(4 * H);
  });

  it('leaves span-expressed keys on their own declared window', () => {
    expect(keyLookbackMs('px.ret_24h', M15)).toBe(24 * H);
    expect(keyLookbackMs('px.ret_4h', M15)).toBe(4 * H);
    expect(keyLookbackMs('atr.4h.14', M15)).toBe((15 + 56) * 4 * H);
  });

  it('separates the two keys that caused the defect by 96x', () => {
    const narrow = keyLookbackMs('px.close', M15) as number;
    const wide = keyLookbackMs('px.ret_24h', M15) as number;
    expect(wide / narrow).toBe(96);
  });
});

describe('keyWindowsForGroup', () => {
  it('splits agg:15m into its distinct windows rather than one', () => {
    const windows = keyWindowsForGroup('agg:15m', M15);
    expect(windows.length).toBeGreaterThan(1);
    // widest first, so a caller can short-circuit when the widest is whole
    expect(windows[0]!.lookbackMs).toBe(24 * H);
    const frameBar = windows.find((w) => w.lookbackMs === M15);
    expect(frameBar?.keys).toEqual(expect.arrayContaining(['px.close', 'px.high', 'px.low']));
  });

  it('puts px.close and px.ret_24h in DIFFERENT windows — the fix, stated', () => {
    const windows = keyWindowsForGroup('agg:15m', M15);
    const of = (key: string) => windows.find((w) => w.keys.includes(key as never))?.lookbackMs;
    expect(of('px.close')).not.toBe(of('px.ret_24h'));
  });

  it('separates atr.1d.14 from ema.1d.200, which is the same bug one group over', () => {
    const windows = keyWindowsForGroup('agg:1d', M15);
    const of = (key: string) => windows.find((w) => w.keys.includes(key as never))?.lookbackMs;
    expect(of('atr.1d.14')).toBe((15 + 56) * 24 * H);
    expect(of('ema.1d.200')).toBe((200 + 400) * 24 * H);
  });

  it('covers every key of the group exactly once', () => {
    // A key dropped here is a key nothing judges; a key duplicated is one judged twice.
    const windows = keyWindowsForGroup('agg:15m', M15);
    const flat = windows.flatMap((w) => w.keys);
    expect(new Set(flat).size).toBe(flat.length);
    const expected = WEB_FEATURE_KEYS.filter((k) => WEB_FEATURE_SPEC[k].inputs.includes('agg:15m' as never));
    expect(flat.sort()).toEqual([...expected].sort());
  });

  it('never returns a window WIDER than the group is read over', () => {
    // The read must cover every window judged, or a key is judged against bars nobody fetched.
    for (const group of groupsFor()) {
      for (const w of keyWindowsForGroup(group, 4 * H)) {
        if (w.lookbackMs !== null) expect(w.lookbackMs).toBeLessThanOrEqual(lookbackMs(group));
      }
    }
  });
});
