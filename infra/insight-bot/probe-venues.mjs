#!/usr/bin/env node
// IB-013 — venue connectivity probe (design §7, D14).
//
// Opens every venue's PUBLIC websocket and waits for a real data message. Read-only: it subscribes
// to public market data, sends no credentials and writes nothing anywhere. Run it from a dev slot
// before the IaC review, and as the FIRST action on a fresh EC2 box — a venue that accepts the
// handshake and then stays mute (observed from blocked regions: fstream.binance.com; Bybit
// restricts some jurisdictions) is a design escalation to the Tech Lead and the Architect, never
// something to work around.
//
//   node infra/insight-bot/probe-venues.mjs [--seconds 30] [--json]
//
// Exit code 0 when every venue sent data, 1 otherwise. Needs Node ≥ 22 (global WebSocket).

const args = process.argv.slice(2);
const seconds = Number(args[args.indexOf('--seconds') + 1]) || 30;
const asJson = args.includes('--json');

/** The four public streams of §4.1–§4.3, each with the subscribe frame the venue wants (if any). */
const VENUES = [
  {
    id: 'binance-perp',
    what: 'USD-M perp kline_1m + markPrice',
    url: 'wss://fstream.binance.com/stream?streams=btcusdt@kline_1m/!markPrice@arr@1s',
  },
  {
    id: 'binance-spot',
    what: 'spot kline_1m',
    url: 'wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1m',
  },
  {
    id: 'bybit-linear',
    what: 'linear tickers',
    url: 'wss://stream.bybit.com/v5/public/linear',
    subscribe: { op: 'subscribe', args: ['tickers.BTCUSDT'] },
    // Bybit answers the subscribe with {success:true, op:'subscribe'}; that is an ack, not data.
    isData: (m) => m?.topic !== undefined,
  },
  {
    id: 'okx-swap',
    what: 'SWAP mark-price',
    url: 'wss://ws.okx.com:8443/ws/v5/public',
    subscribe: { op: 'subscribe', args: [{ channel: 'mark-price', instId: 'BTC-USDT-SWAP' }] },
    isData: (m) => m?.event === undefined && m?.data !== undefined,
  },
];

const ms = () => Number(process.hrtime.bigint() / 1_000_000n);

/** One venue: connect, subscribe, wait for the first data message; never throws. */
function probe(venue, budgetMs) {
  return new Promise((resolve) => {
    const started = ms();
    const result = { id: venue.id, what: venue.what, host: new URL(venue.url).host, open: false, data: false, openMs: null, firstMessageMs: null, messages: 0, note: '' };
    let socket;
    let timer;
    const done = (note) => {
      if (note) result.note = note;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // already closing
      }
      resolve(result);
    };
    timer = setTimeout(() => done(result.open ? `mute for ${budgetMs / 1000}s after the handshake` : `no handshake within ${budgetMs / 1000}s`), budgetMs);
    try {
      socket = new WebSocket(venue.url);
    } catch (e) {
      return done(`could not open: ${e?.name ?? 'Error'}`);
    }
    socket.addEventListener('open', () => {
      result.open = true;
      result.openMs = ms() - started;
      if (venue.subscribe) socket.send(JSON.stringify(venue.subscribe));
    });
    socket.addEventListener('message', (event) => {
      let parsed;
      try {
        parsed = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        parsed = undefined;
      }
      if (venue.isData && !venue.isData(parsed)) return; // an ack, not market data
      result.messages++;
      if (!result.data) {
        result.data = true;
        result.firstMessageMs = ms() - started;
        done('');
      }
    });
    socket.addEventListener('error', () => {
      if (!result.data) done(result.open ? 'socket error after the handshake' : 'connection error');
    });
    socket.addEventListener('close', () => {
      if (!result.data) done(result.note || 'closed before any data');
    });
  });
}

const results = await Promise.all(VENUES.map((v) => probe(v, seconds * 1000)));
const ok = results.every((r) => r.data);

if (asJson) {
  console.log(JSON.stringify({ at: new Date().toISOString(), seconds, ok, results }, null, 2));
} else {
  console.log(`# Venue connectivity probe — ${new Date().toISOString()} (budget ${seconds}s per venue)`);
  console.log('');
  console.log('| venue | stream | host | handshake | first data | verdict |');
  console.log('|---|---|---|---|---|---|');
  for (const r of results) {
    const verdict = r.data ? 'OK' : `MUTE — ${r.note}`;
    console.log(`| ${r.id} | ${r.what} | ${r.host} | ${r.open ? `${r.openMs} ms` : '—'} | ${r.data ? `${r.firstMessageMs} ms` : '—'} | ${verdict} |`);
  }
  console.log('');
  console.log(ok ? 'All venues sent data.' : 'At least one venue is mute — escalate to the Tech Lead and the Architect (design §7).');
}
process.exit(ok ? 0 : 1);
