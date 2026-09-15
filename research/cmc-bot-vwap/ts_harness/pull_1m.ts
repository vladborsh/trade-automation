/**
 * Stage-0 data pull: Capital.com 1-minute history for US100, US500, EURCHF, GBPCHF.
 *
 * Authentication is the bot's own, unmodified `CapitalComSession` (credentials
 * from cmc-bot-main/.env, never printed). The request is byte-for-byte the one
 * `CapitalComClient.realRequest` sends (same URL, headers, `resolution`, `from`/`to`
 * formatting), with two deliberate differences, both documented in README.md:
 *
 *  1. The RAW `prices[]` payload is kept, not passed through
 *     `mapMarketDataToChartData`, because that mapper throws away
 *     `snapshotTimeUTC` and keeps only `snapshotTime` — which is broker-LOCAL
 *     wall-clock time (UTC+2 winter / UTC+3 summer), not UTC. `data_check.ts`
 *     re-applies the bot's own mapper to the stored raw rows and asserts the
 *     OHLCV is identical.
 *  2. Chunks span 998 minutes (<= 999 bars) with max=1000 (the API rejects a 1000-minute span:
 *     `error.invalid.max.daterange`), not the bot's 720/720, purely to cut the
 *     request count. Chunks do not overlap (next from = previous to + 1 minute).
 *
 * Output: research/cmc-bot-vwap/data/raw/<SYMBOL>.ndjson (one raw price row per
 * line, gitignored) + <SYMBOL>.progress (resume checkpoint).
 *
 *   cd cmc-bot-main && TZ=UTC NODE_PATH=../research/cmc-bot-vwap/ts_harness/node_modules \
 *     ../research/cmc-bot-vwap/ts_harness/node_modules/.bin/ts-node --transpile-only \
 *     ../research/cmc-bot-vwap/ts_harness/pull_1m.ts US100,US500,EURCHF,GBPCHF 2024-01-01 2026-09-12
 */
import 'reflect-metadata';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
dotenv.config({ path: path.resolve(__dirname, '../../../cmc-bot-main/.env') });
import { EnvConfig } from '../../../cmc-bot-main/src/env-config';
import { CapitalComSession } from '../../../cmc-bot-main/src/core/services/capital-com-session';

const MIN = 60000;
const SPAN = 998 * MIN; // inclusive [from, to] => at most 999 bars, so a 1000-row reply can only mean truncation
const OUT = path.resolve(__dirname, '../data/raw');
const convertTime = (ms: number) => new Date(ms).toISOString().split('.')[0]; // capital-com-client.ts convertTime
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const [symArg, startArg, endArg] = process.argv.slice(2);
  fs.mkdirSync(OUT, { recursive: true });
  const env = EnvConfig.getInstance();
  const session = new CapitalComSession(env);

  for (const sym of symArg.split(',')) {
    const dataPath = path.join(OUT, `${sym}.ndjson`);
    const progPath = path.join(OUT, `${sym}.progress`);
    let from = Date.parse(`${startArg}T00:00:00Z`);
    const end = Date.parse(`${endArg}T00:00:00Z`);
    if (fs.existsSync(progPath)) from = Number(fs.readFileSync(progPath, 'utf8'));
    else if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath);
    let nReq = 0, nRows = 0, n404 = 0;
    while (from < end) {
      const to = Math.min(from + SPAN, end - MIN);
      let prices: any[] = [];
      for (let attempt = 0; ; attempt++) {
        await sleep(220);
        try {
          await session.checkAndRenewSession();   // the session POST can be rate-limited too
          const r = await axios.get(`${env.CAPITAL_COM_URL}api/v1/prices/${sym}`, {
            headers: { 'X-SECURITY-TOKEN': session.session$.getValue().X_SECURITY_TOKEN, CST: session.session$.getValue().CST },
            params: { resolution: 'MINUTE', max: 1000, from: convertTime(from), to: convertTime(to) },
          });
          prices = r.data.prices;
          break;
        } catch (e: any) {
          const st = e?.response?.status;
          if (st === 404) { n404++; break; }
          if ((st === 429 || st === 401 || st >= 500 || !st) && attempt < 10) {
            if (st === 401) await session.renewSession();
            await sleep(3000 * (attempt + 1));
            continue;
          }
          throw new Error(`${sym} ${convertTime(from)}: ${st} ${JSON.stringify(e?.response?.data)}`);
        }
      }
      nReq++;
      if (prices.length >= 1000) throw new Error(`${sym} ${convertTime(from)}: hit max=1000, would truncate`);
      if (prices.length) fs.appendFileSync(dataPath, prices.map(p => JSON.stringify(p)).join('\n') + '\n');
      nRows += prices.length;
      from = to + MIN;
      fs.writeFileSync(progPath, String(from));
      if (nReq % 100 === 0) console.log(`${sym} ${convertTime(from)} req=${nReq} rows=${nRows} 404=${n404}`);
    }
    console.log(`${sym} DONE req=${nReq} rows=${nRows} 404=${n404}`);
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exit(1); });
