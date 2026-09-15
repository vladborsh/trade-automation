/** Raw /prices response inspection: which timestamp field the bot maps, and how `from`/`to` are interpreted. */
import 'reflect-metadata';
import dotenv from 'dotenv';
import path from 'path';
import axios from 'axios';
dotenv.config({ path: path.resolve(__dirname, '../../../cmc-bot-main/.env') });
import { EnvConfig } from '../../../cmc-bot-main/src/env-config';
import { CapitalComSession } from '../../../cmc-bot-main/src/core/services/capital-com-session';

async function main() {
  const env = EnvConfig.getInstance();
  const session = new CapitalComSession(env);
  await session.renewSession();
  const h = { 'X-SECURITY-TOKEN': session.session$.getValue().X_SECURITY_TOKEN, CST: session.session$.getValue().CST };
  const [sym, from, to, max] = process.argv.slice(2);
  const r = await axios.get(`${env.CAPITAL_COM_URL}api/v1/prices/${sym}`, { headers: h, params: { resolution: 'MINUTE', max: Number(max || 5), from, to } });
  const p = r.data.prices;
  console.log('n', p.length, 'keys', Object.keys(r.data));
  console.log(JSON.stringify(p.slice(0, 2), null, 1));
  console.log(JSON.stringify(p.slice(-1), null, 1));
  const acc = await axios.get(`${env.CAPITAL_COM_URL}api/v1/accounts/preferences`, { headers: h }).catch(e => e.response);
  console.log('prefs', JSON.stringify(acc.data));
  const t = await axios.get(`${env.CAPITAL_COM_URL}api/v1/time`, { headers: h }).catch(e => e.response);
  console.log('servertime', JSON.stringify(t.data), new Date().toISOString());
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e?.response?.status, e?.response?.data || e); process.exit(1); });
