/** Per-field presence of the GoPlus fields we read, per chain family. Tokens come from the DB. */
import { Client } from 'pg';
const UA = 'insight-bot/1.0 (+https://github.com/vladborsh/trade-automation; contact via repository issues)';
const SOL = ['mintable','freezable','closable','metadata_mutable','balance_mutable_authority','total_supply'];
const EVM = ['is_open_source','cannot_buy','buy_tax','sell_tax','holder_count','total_supply'];
const CID = { eth: '1', bsc: '56', base: '8453' };
const PER_NET = Number(process.env.PER_NET ?? '8');

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const out = {};
for (const net of ['solana', 'base', 'bsc', 'eth']) {
  const { rows } = await c.query(
    `select distinct address from dex_tokens where network = $1 order by address limit $2`, [net, PER_NET]);
  const fields = net === 'solana' ? SOL : EVM;
  const tally = { answered: 0, empty: 0, absent: {} };
  for (const { address } of rows) {
    const url = net === 'solana'
      ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`
      : `https://api.gopluslabs.io/api/v1/token_security/${CID[net]}?contract_addresses=${address}`;
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    const j = await r.json().catch(() => ({}));
    const res = j.result ?? {};
    const k = Object.keys(res)[0];
    if (!k) { tally.empty += 1; await new Promise((x) => setTimeout(x, 1200)); continue; }
    tally.answered += 1;
    for (const f of fields) if (!(f in res[k])) tally.absent[f] = (tally.absent[f] ?? 0) + 1;
    await new Promise((x) => setTimeout(x, 1200));
  }
  out[net] = tally;
}
await c.end();
console.log(JSON.stringify({ at: new Date().toISOString(), out }, null, 1));
