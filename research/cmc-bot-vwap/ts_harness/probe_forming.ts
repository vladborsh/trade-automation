/**
 * L-03/L-04 probe: does /prices return the still-FORMING current minute?
 * Fires the bot's exact live request shape (from = now-12h, to = now, max 720,
 * via the bot's own CapitalComClient.getCandles) a few seconds after a minute
 * boundary, like TimerScheduler does, on a 24/7 instrument (weekend), and
 * reports the last candle's openTime vs the wall clock. Also a short-range
 * request so the 720-cap cannot hide it.
 */
import 'reflect-metadata';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../cmc-bot-main/.env') });
import { add } from 'date-fns';
import { EnvConfig } from '../../../cmc-bot-main/src/env-config';
import { CapitalComSession } from '../../../cmc-bot-main/src/core/services/capital-com-session';
import { CapitalComClient } from '../../../cmc-bot-main/src/core/services/capital-com-client';
import { GeneralTimeIntervals } from '../../../cmc-bot-main/src/types/enums';

const sym = process.argv[2] || 'BTCUSD';
async function main() {
  const env = EnvConfig.getInstance();
  const session = new CapitalComSession(env);
  await session.renewSession();
  const client = new CapitalComClient(env, session);
  for (let k = 0; k < 3; k++) {
    const now0 = Date.now();
    const srv = await (await import('axios')).default.get(`${env.CAPITAL_COM_URL}api/v1/time`); console.log('server-minus-host ms', srv.data.serverTime - Date.now());
    await new Promise(r => setTimeout(r, 60000 - (now0 % 60000) + 3500 + k * 7000)); // :00.3, :07.3, :14.3
    const wall = Date.now();
    let exactErr: any = null;
    try { await client.getCandles(sym, GeneralTimeIntervals.m1, add(wall, { hours: -12 }).getTime(), wall); }
    catch (e: any) { exactErr = e?.response?.data?.errorCode || String(e); }
    // to = wall - 3 s, so a host clock slightly ahead of the server cannot turn `to` into the future
    const endTime = wall - 3000;
    const startTime = add(endTime, { hours: -12 }).getTime();
    const big = await client.getCandles(sym, GeneralTimeIntervals.m1, startTime, endTime);
    const small = await client.getCandles(sym, GeneralTimeIntervals.m1, endTime - 5 * 60000, endTime);
    const f = (c: any) => c && { open: new Date(c.openTime).toISOString(), o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume };
    console.log(JSON.stringify({ wall: new Date(wall).toISOString(), to: new Date(endTime).toISOString(), exact_to_now_error: exactErr, big_n: big.length, big_last: f(big[big.length - 1]), small_n: small.length, small_last: f(small[small.length - 1]) }));
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e?.response?.status, e?.response?.data || e); process.exit(1); });
