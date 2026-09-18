// architecture/aggregate-oi.md §4 join measurement (SE-AG1) — step 1 of 2: poll Bybit's public
// tickers every 10 s and append one JSON line per poll. 6 req/min = 0.02 % of Bybit's
// 600 req / 5 s per IP. Run it OUTSIDE the server (never against the coordinator's :3000):
//   node apps/signal-server/scripts/bybit-oi-join/poll.mjs <out.jsonl> [hours=24] [symbol=BTCUSDT]
// Stops by itself after `hours`; kill it by its PID (never by pattern) to stop early.
import { appendFileSync } from 'node:fs';

const [out = 'tickers.jsonl', hours = '24', symbol = 'BTCUSDT'] = process.argv.slice(2);
const url = `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`;

async function tick() {
  const local = Date.now();
  try {
    const res = await fetch(url);
    const body = await res.json();
    const t = body.result?.list?.[0];
    appendFileSync(out, JSON.stringify({
      local, status: res.status, retCode: body.retCode, time: body.time,
      oi: t?.openInterest, single: t?.singleOpenInterest, singleValue: t?.singleOpenInterestValue,
      mark: t?.markPrice, last: t?.lastPrice,
    }) + '\n');
  } catch (err) {
    appendFileSync(out, JSON.stringify({ local, error: String(err) }) + '\n');
  }
}

const stopAt = Date.now() + Number(hours) * 3_600_000;
console.log(`pid ${process.pid}: polling ${symbol} every 10 s into ${out} until ${new Date(stopAt).toISOString()}`);
const timer = setInterval(() => (Date.now() > stopAt ? clearInterval(timer) : void tick()), 10_000);
void tick();
