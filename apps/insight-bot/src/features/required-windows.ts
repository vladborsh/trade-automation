import { WEB_FEATURE_KEYS, WEB_FEATURE_SPEC, type WebFeatureKey } from '@trade-automation/contracts';

/**
 * IB-015 — how far back each input group must be read, and the check that keeps it honest.
 *
 * The pass reads one window per input group and hands slices of it to the calculators. Get a
 * window too short and the symptom is not a crash: the calculator receives fewer bars than it
 * asked for and returns a number computed over the wrong period, which is the failure mode this
 * whole task exists to prevent.
 *
 * **So the table is explicit and a spec cross-checks it against the registry.** The alternative —
 * deriving the lookback from `params` generically — reads well and breaks quietly, because every
 * key expresses its window differently (`hours`, `days`, `settlements`, `period` × `barTf`) and a
 * generic reader that does not recognise a shape silently contributes zero. An explicit table
 * that a spec proves sufficient fails loudly instead, on the day someone widens a window and
 * forgets this file.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Lookback per input group, from the frame's close backwards.
 *
 * The ATR groups carry `period + 1` bars, not `period`: Wilder's recurrence seeds from the first
 * true range, which needs a previous close. `wilderAtr` returns null on exactly `period` bars,
 * so a window one bar short turns a working key into a permanent refusal.
 */
export const GROUP_LOOKBACK_MS: Readonly<Record<string, number>> = {
  // px.* and structure.* read 24 h of 15m bars; structure's pivots need the same window.
  'agg:15m': 24 * HOUR,
  // atr.1h.14 needs 15 bars — but structure.failed_highs_24h reads 24 h of the SAME group, so
  // the group's window is the wider of the two. Written as 15 h first and caught by the spec
  // below on its first run: the key would have answered a 24-hour question with 15 hours of
  // bars, and nothing would have failed.
  'agg:1h': 24 * HOUR,
  // 50 bars for ema.4h.50 (IB-016), which is wider than atr.4h.14's 15.
  'agg:4h': 50 * 4 * HOUR,
  // 200 bars for ema.1d.200 (IB-016). On today's tape candles_agg holds about ten days, so the
  // key refuses — correctly, and as a stated prerequisite of the archive backfill rather than a
  // defect. The window is written for what the key MEANS, not for what the table currently has.
  'agg:1d': 200 * DAY,
  // cvd.*.24h reads 24 h; the slope reads 4 h against the previous 4 h, which is inside it.
  'candles1m:perp': 24 * HOUR,
  'candles1m:spot': 24 * HOUR,
  // oi.at_7d_high is the widest open-interest window.
  oi: 7 * DAY,
  // ls.*.pct30d is a percentile over 30 days of 5-minute slots.
  ls: 30 * DAY,
  // funding is read by COUNT (last 90 settlements), not by window; this is the span that
  // comfortably contains 90 settlements at the 8 h convention, used only for completeness.
  funding: 90 * 8 * HOUR,
  // liq.*.z60m is hourly sums over a 30-day lookback.
  liq: 30 * DAY,
};

export const FEATURE_INPUT_GROUPS: readonly string[] = Object.keys(GROUP_LOOKBACK_MS);

/** The groups a timeframe's keys actually read. Every group, today — kept as a function so a
 *  timeframe-specific key set later does not have to change every caller. */
export function groupsFor(keys: readonly WebFeatureKey[] = WEB_FEATURE_KEYS): string[] {
  const groups = new Set<string>();
  for (const key of keys) for (const group of WEB_FEATURE_SPEC[key].inputs) groups.add(group);
  return [...groups].sort();
}

/**
 * IB-047 — the window ONE KEY needs, which is not the window its group is read over.
 *
 * `GROUP_LOOKBACK_MS` above is the widest window any key in the group needs, and reading at the
 * widest is right: one query per group. **Using it for COMPLETENESS was the bug.** A group's
 * keys span 96× inside `agg:15m` — `px.close` needs one bar, `px.ret_24h` needs ninety-six — so
 * judging them all against ninety-six made the three frame-bar keys refuse whenever the
 * 24-hour key was short. Measured by dev-1: **422 of 477 `px.*` refusals had their own 15m bar
 * complete.**
 *
 * It fails SAFE, which is what made it survive: an over-refusal is indistinguishable from an
 * honest one, so the system reported itself as more data-starved than it was and nothing looked
 * wrong from outside. The inverse of every other defect this week — a confident "cannot know"
 * rather than a confident wrong number — and the pressure it creates is the dangerous part: a
 * playbook that cannot arm for reasons that do not exist is how someone comes to loosen a
 * threshold.
 *
 * Returns null when the key's window is not expressible as a span, in which case the caller
 * falls back to the group window — no worse than today's behaviour, and still safe.
 */
export function keyLookbackMs(key: WebFeatureKey, frameTfMs: number): number | null {
  const { window } = WEB_FEATURE_SPEC[key];
  // 'frame bar' and 'frame' mean the bar the frame is stamped by, so the span depends on the
  // FRAME's timeframe, not on anything in the key's own params: px.close on a 4h frame needs
  // the sixteen 15m bars of that bar, not one.
  if (window === 'frame bar' || window === 'frame') return frameTfMs;
  return declaredLookbackMs(key);
}

/**
 * The distinct completeness windows inside one group, with the keys that need each.
 *
 * Sorted widest-first so the caller can short-circuit: if the widest window is whole, every
 * narrower one inside it is too.
 */
export function keyWindowsForGroup(
  group: string,
  frameTfMs: number,
  keys: readonly WebFeatureKey[] = WEB_FEATURE_KEYS,
): Array<{ lookbackMs: number | null; keys: WebFeatureKey[] }> {
  const byWindow = new Map<number | null, WebFeatureKey[]>();
  for (const key of keys) {
    if (!(WEB_FEATURE_SPEC[key].inputs as readonly string[]).includes(group)) continue;
    const ms = keyLookbackMs(key, frameTfMs);
    byWindow.set(ms, [...(byWindow.get(ms) ?? []), key]);
  }
  return [...byWindow.entries()]
    .map(([lookbackMs, ks]) => ({ lookbackMs, keys: ks.sort() }))
    .sort((a, b) => (b.lookbackMs ?? Infinity) - (a.lookbackMs ?? Infinity));
}

export function lookbackMs(group: string): number {
  const ms = GROUP_LOOKBACK_MS[group];
  if (ms === undefined) {
    throw new Error(
      `no lookback declared for input group "${group}". A key reads it, so the pass must know ` +
      'how far back to read; add it to GROUP_LOOKBACK_MS.',
    );
  }
  return ms;
}

/**
 * The lookback a single key's own parameters imply, or null when the key's window is not
 * expressed as a span (`last settlement`, `latest 5m`, `frame`).
 *
 * This is what the spec compares the table against. It is deliberately NOT used to drive the
 * reads — see the header.
 */
export function declaredLookbackMs(key: WebFeatureKey): number | null {
  const { params } = WEB_FEATURE_SPEC[key];
  const num = (name: string): number | null =>
    typeof params[name] === 'number' ? (params[name] as number) : null;

  // An EMA's `length` and an ATR's `period` are both "N bars", but they need different counts:
  // Wilder seeds from a previous close and so needs N + 1, while the EMA seeds from the SMA of
  // its first N and needs exactly N.
  const length = num('length');
  if (length !== null) {
    const barTf = params['barTf'];
    const barMs = typeof barTf === 'string' ? TF_MS[barTf] : undefined;
    if (barMs === undefined) return null;
    return length * barMs;
  }

  const period = num('period');
  if (period !== null) {
    const barTf = params['barTf'];
    const barMs = typeof barTf === 'string' ? TF_MS[barTf] : undefined;
    if (barMs === undefined) return null;
    return (period + 1) * barMs; // +1: Wilder seeds from a previous close
  }

  const hours = num('hours');
  if (hours !== null) return (hours + (num('previousHours') ?? 0)) * HOUR;

  const days = num('days');
  if (days !== null) return days * DAY;

  const lookbackDays = num('lookbackDays');
  if (lookbackDays !== null) return lookbackDays * DAY;

  const minutes = num('minutes');
  if (minutes !== null) return minutes * 60_000;

  const settlements = num('settlements');
  const settlementHours = num('settlementHours');
  if (settlements !== null && settlementHours !== null) return settlements * settlementHours * HOUR;

  return null;
}

const TF_MS: Readonly<Record<string, number>> = {
  '15m': 15 * 60_000,
  '1h': HOUR,
  '4h': 4 * HOUR,
  '1d': DAY,
};
