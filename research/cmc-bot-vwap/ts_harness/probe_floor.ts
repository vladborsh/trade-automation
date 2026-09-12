/**
 * Extension task 1: is 2024-01-01 a hard vendor floor for 1-minute history, or a
 * request artefact? For each instrument, the same /prices request shape the bot
 * sends, over short weekday windows either side of the floor, at MINUTE and at
 * coarser resolutions (MINUTE_5, MINUTE_15, HOUR, DAY). If coarser resolutions
 * serve 2022-2023 while MINUTE does not, the floor is resolution-specific data
 * retention on Capital.com's side, not a pagination or parameter mistake.
 */
import 'reflect-metadata';
import dotenv from 'dotenv';
import path from 'path';
import axios from 'axios';
dotenv.config({ path: path.resolve(__dirname, '../../../cmc-bot-main/.env') });
import { EnvConfig } from '../../../cmc-bot-main/src/env-config';
import { CapitalComSession } from '../../../cmc-bot-main/src/core/services/capital-com-session';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function main() {
  const env = EnvConfig.getInstance();
  const session = new CapitalComSession(env);
  await session.renewSession();
  const h = { 'X-SECURITY-TOKEN': session.session$.getValue().X_SECURITY_TOKEN, CST: session.session$.getValue().CST };
  const cases: [string, string, string][] = [   // resolution, from, to (UTC; weekday session hours)
    ['MINUTE', '2022-09-14T14:00:00', '2022-09-14T15:00:00'],
    ['MINUTE', '2023-12-28T14:00:00', '2023-12-28T15:00:00'],
    ['MINUTE', '2023-12-29T14:00:00', '2023-12-29T15:00:00'],
    ['MINUTE', '2024-01-02T14:00:00', '2024-01-02T15:00:00'],
    ['MINUTE_5', '2022-09-14T14:00:00', '2022-09-14T18:00:00'],
    ['MINUTE_15', '2022-09-14T14:00:00', '2022-09-15T14:00:00'],
    ['HOUR', '2022-09-12T00:00:00', '2022-09-16T00:00:00'],
    ['DAY', '2022-09-01T00:00:00', '2022-09-30T00:00:00'],
  ];
  for (const sym of ['US100', 'US500', 'EURCHF', 'GBPCHF']) {
    for (const [resolution, from, to] of cases) {
      await sleep(400);
      try {
        const r = await axios.get(`${env.CAPITAL_COM_URL}api/v1/prices/${sym}`, { headers: h, params: { resolution, max: 1000, from, to } });
        const p = r.data.prices;
        console.log(JSON.stringify({ sym, resolution, from, n: p.length, first: p[0]?.snapshotTimeUTC, last: p[p.length - 1]?.snapshotTimeUTC }));
      } catch (e: any) {
        console.log(JSON.stringify({ sym, resolution, from, status: e?.response?.status, error: e?.response?.data?.errorCode }));
      }
    }
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e?.response?.status, e?.response?.data || e); process.exit(1); });
