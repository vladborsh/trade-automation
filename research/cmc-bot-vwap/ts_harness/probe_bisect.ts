/** Bisect the earliest date with 1-minute history per instrument (probing a 2-hour mid-week window each step). */
import 'reflect-metadata';
import dotenv from 'dotenv';
import path from 'path';
import axios from 'axios';
dotenv.config({ path: path.resolve(__dirname, '../../../cmc-bot-main/.env') });
import { EnvConfig } from '../../../cmc-bot-main/src/env-config';
import { CapitalComSession } from '../../../cmc-bot-main/src/core/services/capital-com-session';

const DAY = 86400000;
async function main() {
  const env = EnvConfig.getInstance();
  const session = new CapitalComSession(env);
  await session.renewSession();
  const h = () => ({ 'X-SECURITY-TOKEN': session.session$.getValue().X_SECURITY_TOKEN, CST: session.session$.getValue().CST });
  const has = async (sym: string, dayMs: number) => {
    // any candle in a 3-day span starting at dayMs 12:00 UTC (skips weekends/holidays robustly enough)
    const from = new Date(dayMs + 12 * 3600000).toISOString().split('.')[0];
    const to = new Date(dayMs + 12 * 3600000 + 999 * 60000).toISOString().split('.')[0];
    for (let attempt = 0; ; attempt++) {
      await new Promise(r => setTimeout(r, 400));
      try {
        const r = await axios.get(`${env.CAPITAL_COM_URL}api/v1/prices/${sym}`, { headers: h(), params: { resolution: 'MINUTE', max: 1000, from, to } });
        return r.data.prices.length > 0 ? r.data.prices[0].snapshotTimeUTC : null;
      } catch (e: any) {
        if (e?.response?.status === 404) return null;
        if (e?.response?.status === 429 && attempt < 8) { await new Promise(r => setTimeout(r, 5000 * (attempt + 1))); continue; }
        throw e;
      }
    }
  };
  for (const sym of (process.argv[2] || 'US100,US500,EURCHF,GBPCHF').split(',')) {
    let lo = Date.parse('2020-01-01'), hi = Date.parse('2026-09-01'); // lo: no data (assumed), hi: data
    if (await has(sym, lo)) { console.log(sym, 'data already at 2020-01-01'); continue; }
    while (hi - lo > DAY) {
      const mid = lo + Math.floor((hi - lo) / DAY / 2) * DAY;
      if (await has(sym, mid)) hi = mid; else lo = mid;
    }
    // weekend/holiday gaps can fool the bisection: confirm by scanning 14 days after the found boundary
    const around: string[] = [];
    for (let d = -3; d < 10; d++) { const f = await has(sym, hi + d * DAY); around.push(`${new Date(hi + d * DAY).toISOString().slice(0, 10)}:${f ? 'Y' : '-'}`); }
    console.log(sym, 'earliest~', new Date(hi).toISOString().slice(0, 10), around.join(' '));
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e?.response?.status, e?.response?.data || e); process.exit(1); });
