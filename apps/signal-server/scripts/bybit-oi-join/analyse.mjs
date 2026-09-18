// architecture/aggregate-oi.md §4 join measurement (SE-AG1) — step 2 of 2: compare the polled
// tickers (poll.mjs) with Bybit's OI history and 5-min mark-price bars over the same span.
//   node apps/signal-server/scripts/bybit-oi-join/analyse.mjs <tickers.jsonl> [symbol=BTCUSDT]
// Public endpoints, paced 2 req/s, a handful of pages. Answers:
//  (a) which instant a history row stamped t is: |row single − tickers single| at t−1m … t+5m,
//      and the lag of the best-matching poll;
//  (b) the step at the history→tip join: |derived(t) − venue tip at t| with derived = row single
//      × close of the mark bar ENDING at t (as built) vs STARTING at t, in bps and as a fraction
//      of the median |5 m ΔOI_usd|. Rule (§4): p90 step < 10 % of the median 5 m move.
import { readFileSync } from 'node:fs';

const [file = 'tickers.jsonl', symbol = 'BTCUSDT'] = process.argv.slice(2);
const BAR = 300_000;
const TOL = 6_000; // a poll every 10 s → one within ±5 s of any instant
const ticks = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  .filter((t) => t.retCode === 0 && t.time)
  .map((t) => ({ time: t.time, single: +t.single, value: +t.singleValue, mark: +t.mark }))
  .sort((a, b) => a.time - b.time);
const t0 = ticks[0].time;
const t1 = ticks[ticks.length - 1].time;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path, params) {
  await sleep(500);
  const url = new URL(path, 'https://api.bybit.com');
  for (const [k, v] of Object.entries({ category: 'linear', symbol, ...params })) url.searchParams.set(k, String(v));
  const body = await (await fetch(url)).json();
  if (body.retCode !== 0) throw new Error(`${path}: ${body.retMsg}`);
  return body.result.list;
}
// Newest-first venue: walk backward (aggregate-oi.md §5).
async function walkBack(page, from, to, limit, stamp) {
  let out = [];
  for (let end = to; ;) {
    const list = await page(end);
    if (list.length === 0) break;
    out = [...list, ...out];
    const oldest = Math.min(...list.map(stamp));
    if (list.length < limit || oldest <= from) break;
    end = oldest - 1;
  }
  return out;
}
const from = t0 - 2 * 3_600_000;
const hist = (await walkBack((end) => get('/v5/market/open-interest', { intervalTime: '5min', limit: 200, startTime: from, endTime: end }), from, t1, 200, (r) => +r.timestamp))
  .map((r) => ({ t: +r.timestamp, single: +r.singleOpenInterest })).sort((a, b) => a.t - b.t);
const marks = new Map((await walkBack((end) => get('/v5/market/mark-price-kline', { interval: 5, limit: 1000, start: from - BAR, end }), from - BAR, t1, 1000, (r) => +r[0]))
  .map((r) => [+r[0], +r[4]]));

const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
function nearest(at) {
  let lo = 0, hi = ticks.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ticks[mid].time < at) lo = mid + 1; else hi = mid; }
  const c = [ticks[lo - 1], ticks[lo]].filter(Boolean).sort((a, b) => Math.abs(a.time - at) - Math.abs(b.time - at))[0];
  return c && Math.abs(c.time - at) <= TOL ? c : null;
}
const rows = hist.filter((h) => h.t - 60_000 >= t0 && h.t + 5 * 60_000 <= t1);
console.log(`${symbol}: ${ticks.length} polls ${new Date(t0).toISOString()} → ${new Date(t1).toISOString()} (${f((t1 - t0) / 3.6e6)} h); ${rows.length} history rows fully inside`);

console.log('\n(a) which instant is a row stamped t?  |row single − tickers single| (base units)');
for (let k = -1; k <= 5; k++) {
  const d = rows.map((h) => nearest(h.t + k * 60_000)).map((tk, i) => (tk ? Math.abs(tk.single - rows[i].single) : null)).filter((x) => x !== null);
  console.log(`  tickers at t${k >= 0 ? '+' : ''}${k}m: n=${d.length} median ${f(q(d, 0.5), 3)} p90 ${f(q(d, 0.9), 3)} exact ${d.filter((x) => x < 1e-9).length}`);
}
const lags = rows.map((h) => {
  let best = null;
  for (const tk of ticks) if (tk.time >= h.t - 60_000 && tk.time <= h.t + 6 * 60_000 && (!best || Math.abs(tk.single - h.single) < Math.abs(best.single - h.single))) best = tk;
  return best && Math.abs(best.single - h.single) < 1e-9 ? (best.time - h.t) / 1000 : null;
});
const exactLags = lags.filter((x) => x !== null);
console.log(`  rows equal to some poll in [t−1m, t+6m]: ${exactLags.length}/${rows.length}; lag of the first equal poll (s): p10 ${f(q(exactLags, 0.1), 1)} median ${f(q(exactLags, 0.5), 1)} p90 ${f(q(exactLags, 0.9), 1)}`);

console.log('\n(b) step at the join: |derived(t) − tickers singleOpenInterestValue at t|');
for (const [name, barStart] of [['ENDING at t (built)', (t) => t - BAR], ['STARTING at t', (t) => t]]) {
  const bps = [], usd = [];
  for (const h of rows) {
    const m = marks.get(barStart(h.t));
    const tk = nearest(h.t);
    if (!m || !tk) continue;
    const derived = h.single * m;
    usd.push(Math.abs(derived - tk.value));
    bps.push((Math.abs(derived - tk.value) / tk.value) * 1e4);
  }
  const moves = [];
  for (let i = 1; i < hist.length; i++) {
    const a = marks.get(barStart(hist[i - 1].t)), b = marks.get(barStart(hist[i].t));
    if (a && b && hist[i].t - hist[i - 1].t === BAR) moves.push(Math.abs(hist[i].single * b - hist[i - 1].single * a));
  }
  const mm = q(moves, 0.5);
  console.log(`  mark bar ${name}: n=${bps.length} joins`);
  console.log(`    bps     median ${f(q(bps, 0.5))} p90 ${f(q(bps, 0.9))} p99 ${f(q(bps, 0.99))} max ${f(Math.max(...bps))}`);
  console.log(`    USD     median ${f(q(usd, 0.5), 0)} p90 ${f(q(usd, 0.9), 0)} p99 ${f(q(usd, 0.99), 0)}`);
  console.log(`    median |5m ΔOI_usd| ${f(mm, 0)} (n=${moves.length}) → step/move median ${f((q(usd, 0.5) / mm) * 100, 1)} % p90 ${f((q(usd, 0.9) / mm) * 100, 1)} % p99 ${f((q(usd, 0.99) / mm) * 100, 1)} %`);
}
// The derived tip alternative (single × tickers markPrice) vs the venue's own figure.
const inner = ticks.map((t) => (Math.abs(t.value - t.single * t.mark) / t.value) * 1e4);
console.log(`\ntickers singleOpenInterestValue vs single × markPrice: median ${f(q(inner, 0.5), 4)} bps, max ${f(Math.max(...inner), 4)} bps (n=${inner.length})`);
