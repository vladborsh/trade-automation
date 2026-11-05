import { EPISODE_GAP_SEC } from '../../insights/thresholds';

/**
 * IB-133 (liquidation-episodes design E1) — the one definition of a liquidation **episode**, used by
 * both the page's episodes and the norm (E2), so the threshold is learnt from exactly the thing it
 * is compared with.
 *
 * An episode is a run of prints, each already ≥ $100K (the caller's read), all on ONE side, across
 * every coin and venue, where neighbouring prints are less than `EPISODE_GAP_SEC` apart: a pause of
 * exactly 180 s starts a new episode, 179 s does not. Gaps are measured in milliseconds on the tape's
 * own timestamps, not on rounded seconds.
 *
 * This is NOT `groupSeries` (R3/Market: ≥ 3 prints within 10 min of the first). One cascade with a
 * 3-minute pause is two episodes here and may be one series there; the help says so (E9).
 */

export interface EpisodePrint {
  timeMs: number;
  side: 'long' | 'short';
  usd: number;
  /** Canonical symbol (`BTCUSDT`, aliases folded in), or the venue's own spelling when unmapped. */
  symbol: string;
  base: string;
  venue: string;
}

export interface EpisodeCandidate {
  /** `${side}-${fromSec}`. */
  id: string;
  side: 'long' | 'short';
  fromMs: number;
  toMs: number;
  count: number;
  usd: number;
  /** Per coin (canonical symbol), largest first. */
  coins: Array<{ base: string; symbol: string; usd: number }>;
  /** Each venue's whole-percent share, largest remainder (sums to 100), largest first. */
  venues: Array<{ venue: string; pct: number }>;
  /** USD per minute (minute start, sec), oldest first, non-empty minutes only. */
  perMinute: Array<{ time: number; usd: number }>;
  /** Every print, largest first (ties: earlier first). The answer cuts these by `minUsd` and to 20. */
  prints: EpisodePrint[];
}

/**
 * Whole-percent shares of `values` that sum to exactly 100 (Hamilton / largest remainder): floor
 * each exact share, then hand the missing points to the largest remainders. Ties go to the earlier
 * index, so the result is deterministic. All zeros (or empty) gives all zeros.
 */
export function largestRemainder(values: readonly number[]): number[] {
  const total = values.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * 100);
  const out = exact.map((x) => Math.floor(x));
  let missing = 100 - out.reduce((s, v) => s + v, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (missing <= 0) break;
    out[i] = (out[i] as number) + 1;
    missing -= 1;
  }
  return out;
}

/** E1: the episodes of a set of prints (any order), oldest first by `fromMs`. */
export function groupEpisodes(prints: readonly EpisodePrint[], gapSec: number = EPISODE_GAP_SEC): EpisodeCandidate[] {
  const gapMs = gapSec * 1000;
  const runs: EpisodePrint[][] = [];
  for (const side of ['long', 'short'] as const) {
    const sorted = prints.filter((p) => p.side === side).sort((a, b) => a.timeMs - b.timeMs);
    let run: EpisodePrint[] = [];
    for (const p of sorted) {
      const last = run[run.length - 1];
      if (last !== undefined && p.timeMs - last.timeMs >= gapMs) {
        runs.push(run);
        run = [];
      }
      run.push(p);
    }
    if (run.length > 0) runs.push(run);
  }
  return runs.map(toCandidate).sort((a, b) => a.fromMs - b.fromMs || a.side.localeCompare(b.side));
}

/** Only the sums, for the norm (E2): the same grouping, nothing else kept. */
export function episodeSums(prints: readonly EpisodePrint[], gapSec: number = EPISODE_GAP_SEC): number[] {
  return groupEpisodes(prints, gapSec).map((e) => e.usd);
}

function toCandidate(run: EpisodePrint[]): EpisodeCandidate {
  const first = run[0] as EpisodePrint;
  const last = run[run.length - 1] as EpisodePrint;
  const usd = run.reduce((s, p) => s + p.usd, 0);

  const coins = new Map<string, { base: string; symbol: string; usd: number }>();
  const venues = new Map<string, number>();
  const minutes = new Map<number, number>();
  for (const p of run) {
    const c = coins.get(p.symbol) ?? { base: p.base, symbol: p.symbol, usd: 0 };
    c.usd += p.usd;
    coins.set(p.symbol, c);
    venues.set(p.venue, (venues.get(p.venue) ?? 0) + p.usd);
    const minute = Math.floor(p.timeMs / 60_000) * 60;
    minutes.set(minute, (minutes.get(minute) ?? 0) + p.usd);
  }
  const venueList = [...venues].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const pcts = largestRemainder(venueList.map(([, v]) => v));
  const fromSec = Math.floor(first.timeMs / 1000);

  return {
    id: `${first.side}-${fromSec}`,
    side: first.side,
    fromMs: first.timeMs,
    toMs: last.timeMs,
    count: run.length,
    usd,
    coins: [...coins.values()].sort((a, b) => b.usd - a.usd || a.symbol.localeCompare(b.symbol)),
    venues: venueList.map(([venue], i) => ({ venue, pct: pcts[i] as number })),
    perMinute: [...minutes].sort((a, b) => a[0] - b[0]).map(([time, v]) => ({ time, usd: v })),
    prints: [...run].sort((a, b) => b.usd - a.usd || a.timeMs - b.timeMs),
  };
}
