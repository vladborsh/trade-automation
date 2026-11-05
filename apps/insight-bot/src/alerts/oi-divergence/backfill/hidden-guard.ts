import { OI_DIVERGENCE_TFS, type OiDivergenceDirection, type OiDivergenceTf } from '@trade-automation/contracts';
import type { Detection, HiddenDetection, KindCounts } from './history-backfill';

/**
 * IB-144 (architecture/oi-divergence-design-2026-11-04.md V47) — the guard that decides, per TF, whether hidden OI
 * divergence alerts may be SENT. It replaces the owner's look with checks that fail on the two ways this goes wrong:
 * too many signals, or a broken detector. Pure: the dry run's dump, the journal's backfill keys and the number of
 * `oi_alerts` users in, a per-TF verdict out. `hidden-guard.cli.ts` reads those and, only with `--enable`, applies it.
 *
 * Per TF, ALL must hold:
 * 1. **rate:** hidden found ≤ 3 × regular found over the SAME closes (IB-116's window); a TF with 0 regular stays off;
 * 2. **regular unchanged:** the dry run's regular alerts in the window are exactly the journal's `backfill` regular
 *    rows of that TF — same count, same (symbol, direction, A, B) keys — so the new branch did not move the old path;
 * 3. **0 violations over every hidden alert of the run** (all closes, not only the window):
 *    - the signs match the kind: bullish = price higher at B and OI lower, bearish = the reverse (and the stated
 *      percentages agree);
 *    - |i_oi − i_price| ≤ k at both ends; B − A ≤ W bars;
 *    - **an independent recheck of both lines on the bars**: no wick and no per-bar OI beyond the line, on the pivot
 *      kind's side (lows: below; highs: above), by more than its tolerance. Written HERE, not with the detector's
 *      `diverges` / `oiPerBar` / `atrAt`: the per-bar OI is rebuilt from the raw 5 m readings, ATR14 and the |ΔOI|
 *      median from the bars, and the A / B values the dump states must equal what the bars give.
 * And once for all TFs: **exactly one user has `oi_alerts`** (the owner) — otherwise nothing is enabled.
 */
export const HIDDEN_RATE_MAX = 3;
const ATR_N = 14;
const MEDIAN_N = 100;

export interface GuardInput {
  /** Every hidden detection the run dumped, with its bars and raw OI. */
  hidden: readonly HiddenDetection[];
  /** Every detection's key (regular and hidden) and the per-(tf, kind) counts, from the dump's summary line. */
  detections: readonly Detection[];
  kinds: readonly KindCounts[];
  /** The journal's `source = 'backfill'` REGULAR rows (IB-116's run). */
  journalRegular: ReadonlyArray<{ tf: OiDivergenceTf; symbol: string; direction: OiDivergenceDirection; aTime: number; bTime: number }>;
  /** Users with `oi_alerts` (V13: the recipients; must be exactly the owner). */
  oiAlertUsers: number;
  /** Today's `perTf[tf].sendHidden`: a TF already on is reported, never re-enabled. */
  sendHidden: Record<OiDivergenceTf, boolean>;
}

export interface Violation {
  key: string;
  check: 'sign' | 'k' | 'w' | 'price_line' | 'oi_line' | 'endpoint' | 'context';
  detail: string;
}

export interface TfVerdict {
  tf: OiDivergenceTf;
  hidden: number;
  regular: number;
  rate: { pass: boolean; ratio: number | null };
  regularUnchanged: { pass: boolean; dry: number; journal: number; missing: string[]; extra: string[] };
  sanity: { pass: boolean; checked: number; violations: Violation[] };
  pass: boolean;
  alreadyOn: boolean;
}

export interface GuardVerdict {
  perTf: TfVerdict[];
  users: { count: number; pass: boolean };
  /** The TFs a guarded update would switch on: passing, still off, and only while exactly one user has oi_alerts. */
  enable: OiDivergenceTf[];
}

export function evaluateGuard(input: GuardInput): GuardVerdict {
  const users = { count: input.oiAlertUsers, pass: input.oiAlertUsers === 1 };
  const perTf = OI_DIVERGENCE_TFS.map((tf): TfVerdict => {
    const count = (kind: 'regular' | 'hidden') => input.kinds.find((k) => k.tf === tf && k.kind === kind)?.found ?? 0;
    const hidden = count('hidden');
    const regular = count('regular');
    const rate = { pass: regular > 0 && hidden <= HIDDEN_RATE_MAX * regular, ratio: regular > 0 ? hidden / regular : null };

    const key = (x: { symbol: string; direction: string; aTime: number; bTime: number }) => `${x.symbol}|${x.direction}|${x.aTime}|${x.bTime}`;
    const dry = new Set(input.detections.filter((d) => d.tf === tf && d.kind === 'regular' && d.inWindow).map(key));
    const journal = new Set(input.journalRegular.filter((j) => j.tf === tf).map(key));
    const missing = [...journal].filter((k) => !dry.has(k));
    const extra = [...dry].filter((k) => !journal.has(k));
    const regularUnchanged = { pass: dry.size === journal.size && missing.length === 0 && extra.length === 0, dry: dry.size, journal: journal.size, missing, extra };

    const mine = input.hidden.filter((h) => h.tf === tf);
    const violations = mine.flatMap(recheck);
    // a hidden detection the summary counts but the dump does not carry was never checked: that is a violation too
    const dumped = new Set(mine.map((h) => `${h.symbol}|${h.direction}|${h.aTime}|${h.bTime}`));
    for (const d of input.detections.filter((x) => x.tf === tf && x.kind === 'hidden')) {
      if (!dumped.has(key(d))) violations.push({ key: key(d), check: 'context', detail: 'counted but not in the dump: not rechecked' });
    }
    const sanity = { pass: violations.length === 0, checked: mine.length, violations };
    return {
      tf, hidden, regular, rate, regularUnchanged, sanity,
      pass: rate.pass && regularUnchanged.pass && sanity.pass, alreadyOn: input.sendHidden[tf],
    };
  });
  return { perTf, users, enable: users.pass ? perTf.filter((v) => v.pass && !v.alreadyOn).map((v) => v.tf) : [] };
}

/** Every V47 sanity check on one hidden detection, from its own bars and raw OI. Empty = clean. */
export function recheck(h: HiddenDetection): Violation[] {
  const key = `${h.symbol}|${h.direction}|${h.aTime}|${h.bTime}`;
  const out: Violation[] = [];
  const v = (check: Violation['check'], detail: string) => out.push({ key, check, detail });
  const low = h.direction === 'bullish';
  const tf = h.tfSec;

  // signs: hidden bullish = a HIGHER low with LOWER OI; hidden bearish = a LOWER high with HIGHER OI
  const priceUp = h.b.price > h.a.price;
  const oiUp = h.b.oi > h.a.oi;
  const signsOk = low ? priceUp && h.b.oi < h.a.oi && h.pricePct > 0 && h.oiPct < 0 : h.b.price < h.a.price && oiUp && h.pricePct < 0 && h.oiPct > 0;
  if (!signsOk) v('sign', `price ${h.a.price} → ${h.b.price} (${h.pricePct.toFixed(3)} %), OI ${h.a.oi} → ${h.b.oi} (${h.oiPct.toFixed(3)} %)`);

  // pairing reach k at both ends, lookback W
  const ownerBar = (t: number) => Math.ceil(t / tf) * tf - tf; // a 5 m reading labelled t belongs to the bar open < t ≤ close
  for (const [end, p] of [['A', h.a], ['B', h.b]] as const) {
    const d = Math.abs(ownerBar(p.oiTime) - p.time) / tf;
    if (d > h.params.k) v('k', `${end}: OI pivot ${d} bars from the price pivot, k = ${h.params.k}`);
  }
  const span = (h.b.time - h.a.time) / tf;
  if (span > h.params.w) v('w', `B − A = ${span} bars, W = ${h.params.w}`);

  // the bars and the per-bar OI, rebuilt here
  const bars = [...h.bars].sort((x, y) => x.time - y.time);
  const at = new Map(bars.map((b, i) => [b.time, i]));
  const ia = at.get(h.a.time);
  const ib = at.get(h.b.time);
  if (ia === undefined || ib === undefined) { v('context', 'A or B is not among the dumped bars'); return out; }
  const perBar = bars.map((b) => {
    const inBar = h.oi5m.filter((o) => o.time > b.time && o.time <= b.time + tf);
    if (inBar.length === 0) return null;
    const pick = inBar.reduce((best, o) => (low ? (o.oi < best.oi ? o : best) : (o.oi > best.oi ? o : best)));
    return pick.oi;
  });
  const wick = (i: number) => (low ? bars[i].low : bars[i].high);
  if (wick(ia) !== h.a.price || wick(ib) !== h.b.price) v('endpoint', `stated A/B price ${h.a.price}/${h.b.price}, bars give ${wick(ia)}/${wick(ib)}`);
  const oa = at.get(ownerBar(h.a.oiTime));
  const ob = at.get(ownerBar(h.b.oiTime));
  if (oa === undefined || ob === undefined) { v('context', 'an OI pivot bar is not among the dumped bars'); return out; }
  if (perBar[oa] !== h.a.oi || perBar[ob] !== h.b.oi) v('endpoint', `stated A/B OI ${h.a.oi}/${h.b.oi}, raw readings give ${perBar[oa]}/${perBar[ob]}`);

  // beyond the line on the PIVOT's side (lows: below, highs: above), by more than the tolerance
  const beyond = (value: number, line: number, tol: number) => (low ? value < line - tol : value > line + tol);
  const lineAt = (x0: number, y0: number, x1: number, y1: number, x: number) => y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  for (let t = ia + 1; t < ib; t++) {
    const line = lineAt(ia, h.a.price, ib, h.b.price, t);
    const atr = atr14(bars, t);
    const tol = atr === null ? 0 : h.params.priceLineTolAtrMult * atr;
    if (beyond(wick(t), line, tol)) v('price_line', `bar ${bars[t].time}: wick ${wick(t)} vs line ${line.toFixed(6)} ± ${tol.toFixed(6)}`);
  }
  const med = medianMove(perBar, ib);
  if (med === null) { v('context', 'fewer than 20 per-bar OI moves before B in the dump'); return out; }
  const oiTol = h.params.oiLineTolMedianMult * med;
  for (let t = oa + 1; t < ob; t++) {
    const value = perBar[t];
    if (value === null) continue;
    const line = lineAt(oa, h.a.oi, ob, h.b.oi, t);
    if (beyond(value, line, oiTol)) v('oi_line', `bar ${bars[t].time}: OI ${value} vs line ${line.toFixed(3)} ± ${oiTol.toFixed(3)}`);
  }
  return out;
}

/** ATR14 at bar i from the bars alone (true range needs the previous close); null without 14 earlier bars. */
function atr14(bars: ReadonlyArray<{ high: number; low: number; close: number; time: number }>, i: number): number | null {
  if (i < ATR_N) return null;
  let sum = 0;
  for (let t = i - ATR_N + 1; t <= i; t++) {
    if (bars[t].time - bars[t - 1].time !== bars[1].time - bars[0].time) return null; // a gap in the dump: unknown
    const pc = bars[t - 1].close;
    sum += Math.max(bars[t].high - bars[t].low, Math.abs(bars[t].high - pc), Math.abs(bars[t].low - pc));
  }
  return sum / ATR_N;
}

/** The median |Δ per-bar OI| over the 100 bars before B (both ends known), as V7 defines δoi's basis. */
function medianMove(perBar: ReadonlyArray<number | null>, ib: number): number | null {
  const moves: number[] = [];
  for (let t = Math.max(1, ib - MEDIAN_N); t < ib; t++) {
    const x = perBar[t - 1];
    const y = perBar[t];
    if (x !== null && y !== null) moves.push(Math.abs(y - x));
  }
  if (moves.length < 20) return null;
  moves.sort((x, y) => x - y);
  const m = Math.floor(moves.length / 2);
  return moves.length % 2 === 1 ? moves[m] : (moves[m - 1] + moves[m]) / 2;
}

/** The table the CLI prints and the morning report quotes. */
export function verdictTable(g: GuardVerdict): string[] {
  const yes = (b: boolean) => (b ? 'PASS' : 'FAIL');
  const lines = [
    '| TF | hidden | regular | ratio ≤ 3 | regular unchanged (dry / journal) | sanity (checked, violations) | verdict | already on |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const v of g.perTf) {
    lines.push(`| ${v.tf} | ${v.hidden} | ${v.regular} | ${yes(v.rate.pass)} (${v.rate.ratio === null ? '— no regular' : v.rate.ratio.toFixed(2)}) | `
      + `${yes(v.regularUnchanged.pass)} (${v.regularUnchanged.dry} / ${v.regularUnchanged.journal}) | ${yes(v.sanity.pass)} (${v.sanity.checked}, ${v.sanity.violations.length}) | `
      + `**${yes(v.pass)}** | ${v.alreadyOn ? 'yes' : 'no'} |`);
  }
  lines.push(`users with oi_alerts: ${g.users.count} → ${yes(g.users.pass)} (exactly one required)`);
  lines.push(`would enable: ${g.enable.length > 0 ? g.enable.join(', ') : 'nothing'}`);
  return lines;
}
