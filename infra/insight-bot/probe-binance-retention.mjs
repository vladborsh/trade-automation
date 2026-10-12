// IB-045 — measure how far back Binance's /futures/data/* endpoints actually serve.
// Public market data, read-only. One request per (endpoint, offset): ~40 requests per round,
// weight 1 each => ~40 weight per round against the 2400/min budget, i.e. under 2%.
const ENDPOINTS = [
  ['globalLongShortAccountRatio', 'ls.global_account'],
  ['topLongShortPositionRatio',   'ls.top_position'],
  ['takerlongshortRatio',         'ls.taker'],
  ['openInterestHist',            'oi.*'],
];
const OFFSETS_D = [20, 25, 28, 29, 30, 31, 32, 35, 45, 90];
const SYMBOL = 'BTCUSDT';

async function probe(ep, days) {
  const start = Date.now() - days * 86400000;
  const url = `https://fapi.binance.com/futures/data/${ep}?symbol=${SYMBOL}&period=5m`
            + `&startTime=${start}&endTime=${start + 3600000}&limit=500`;
  const r = await fetch(url);
  if (!r.ok) return { days, n: -1, note: `HTTP ${r.status}` };
  const body = await r.json();
  if (!Array.isArray(body)) return { days, n: -1, note: JSON.stringify(body).slice(0, 80) };
  return { days, n: body.length, first: body[0]?.timestamp ?? null };
}

const round = process.argv[2] ?? '1';
for (const [ep, keys] of ENDPOINTS) {
  const out = [];
  for (const d of OFFSETS_D) { out.push(await probe(ep, d)); await new Promise(r => setTimeout(r, 120)); }
  const served = out.filter(o => o.n > 0).map(o => o.days);
  const empty  = out.filter(o => o.n === 0).map(o => o.days);
  const errored = out.filter(o => o.n === -1);
  console.log(`round ${round} | ${ep.padEnd(30)} (${keys})`);
  console.log(`  served at D-days: ${served.join(', ') || 'none'}`);
  console.log(`  EMPTY  at D-days: ${empty.join(', ') || 'none'}`);
  if (errored.length) for (const e of errored) console.log(`  ERROR at ${e.days}d: ${e.note}`);
  const boundary = served.length && empty.length
    ? `between ${Math.max(...served)}d and ${Math.min(...empty)}d`
    : served.length ? `>= ${Math.max(...served)}d (no empty probe)` : 'nothing served';
  console.log(`  boundary: ${boundary}`);
}
