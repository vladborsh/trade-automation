// IB-028 — SUSTAINED rate, which is the number a poller needs. A venue's published rate is a
// claim; the rate it tolerates under continuous load is the fact (the lesson from IB-036's
// CoinGecko spacing). Two minutes per step, a pause between, so one step cannot drain the next.
const NET = ['solana', 'base', 'bsc', 'eth'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DURATION_MS = 120_000;

for (const gapMs of [12000, 10000]) {
  await sleep(45_000);                   // let the window drain completely first
  const statuses = [];
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < DURATION_MS) {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/${NET[i % 4]}/new_pools?page=1`,
      { headers: { 'user-agent': 'insight-bot/1.0', accept: 'application/json' } });
    statuses.push(r.status);
    await r.arrayBuffer();
    i += 1;
    await sleep(gapMs);
  }
  const ok = statuses.filter(s => s === 200).length;
  const refused = statuses.filter(s => s === 429).length;
  const mins = (Date.now() - t0) / 60000;
  console.log(`gap ${gapMs}ms (~${(60000/gapMs).toFixed(0)}/min target): ${ok} ok, ${refused} refused over ${mins.toFixed(1)} min = ${(ok/mins).toFixed(1)} ok/min`);
}
