import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { BybitSocket } from '../../src/collectors/bybit/bybit-socket';
import { OkxSocket } from '../../src/collectors/okx/okx-socket';

/**
 * IB-BUG-051: the bybit / okx dead-socket rule, driven against REAL `ws` clients and local servers,
 * because the failure is in how a real socket behaves: one that never finishes its handshake
 * emits neither `open` nor `close`, so a rule armed by either never fires.
 *
 * Four servers, each one a way a venue route can die or stay healthy:
 * - **tcp-mute**: accepts the TCP connection, never answers the upgrade (no handshake, no bytes);
 * - **ws-mute**: completes the handshake, then sends nothing at all;
 * - **pong-only**: acks every subscribe and answers every ping, but no topic ever delivers. That is
 *   a dead route that looks alive at the protocol level (the IB-005 / BUG-019 shape);
 * - **liveness-only** (the control): the liveness topic (bybit `tickers.*`, okx `mark-price`) flows,
 *   the liquidation topic is silent, as in a quiet market. This must NOT reconnect.
 *
 * Times are scaled down (silence 300 ms, checked every 25 ms, a 1.7 s window) and every count is at the server,
 * not in the client under test.
 */

const SILENCE_MS = 300;
const TICK_MS = 25;
/** okx re-opens through its close → backoff path (first backoff 1 s); bybit re-opens at once. Both fit. */
const WINDOW_MS = SILENCE_MS + 1_000 + 400;

interface Venue {
  name: 'bybit' | 'okx';
  /** A liveness data frame in the venue's own envelope. */
  liveness(): string;
  /** Answer to the client's heartbeat, or null when the frame is not a heartbeat. */
  pong(frame: string): string | null;
  /** Ack for a subscribe frame, or null. */
  ack(frame: string): string | null;
  open(url: string, onError: (m: string) => void): { check(): boolean; stop(): void };
}

const BYBIT: Venue = {
  name: 'bybit',
  liveness: () => JSON.stringify({ topic: 'tickers.BTCUSDT', type: 'delta', ts: Date.now(), data: { symbol: 'BTCUSDT', markPrice: '100000' } }),
  pong: (f) => (f.includes('"op":"ping"') ? JSON.stringify({ success: true, ret_msg: 'pong', conn_id: 'c', op: 'ping' }) : null),
  ack: (f) => (f.includes('"op":"subscribe"') ? JSON.stringify({ success: true, ret_msg: '', conn_id: 'c', op: 'subscribe' }) : null),
  open(url, onError) {
    const socket = new BybitSocket({
      url,
      topics: ['tickers.BTCUSDT', 'allLiquidation.BTCUSDT'],
      silenceMs: SILENCE_MS,
      pingMs: 40,
      handlers: { onOpen: () => {}, onMessage: () => {}, onClose: () => {}, onError, onSubscribeFailed: onError },
    });
    socket.open();
    return { check: () => socket.checkSilence(), stop: () => socket.stop() };
  },
};

const OKX: Venue = {
  name: 'okx',
  liveness: () => JSON.stringify({ arg: { channel: 'mark-price', instId: 'BTC-USDT-SWAP' }, data: [{ instId: 'BTC-USDT-SWAP', markPx: '100000', ts: String(Date.now()) }] }),
  pong: (f) => (f === 'ping' ? 'pong' : null),
  ack: (f) => (f.includes('"op":"subscribe"') ? JSON.stringify({ event: 'subscribe', arg: { channel: 'liquidation-orders', instType: 'SWAP' }, connId: 'c' }) : null),
  open(url, onError) {
    const socket = new OkxSocket({
      wsUrl: url,
      subscriptions: [{ channel: 'liquidation-orders', instType: 'SWAP' }, { channel: 'mark-price', instId: 'BTC-USDT-SWAP' }],
      silenceMs: SILENCE_MS,
      handlers: { onOpen: () => {}, onMessage: () => {}, onVenueError: onError, onClose: () => {}, onError },
    });
    socket.open();
    return { check: () => socket.checkSilence(), stop: () => socket.close() };
  },
};

type Behaviour = 'tcp-mute' | 'ws-mute' | 'pong-only' | 'liveness-only';

interface Running {
  url: string;
  /** Connection attempts the server has seen (TCP accepts, or completed upgrades). */
  connections(): number;
  close(): Promise<void>;
}

async function serve(venue: Venue, behaviour: Behaviour): Promise<Running> {
  if (behaviour === 'tcp-mute') {
    const held: Socket[] = [];
    let accepted = 0;
    const server: Server = createServer((s) => {
      accepted++;
      held.push(s); // read the upgrade request, answer nothing, ever
      s.on('error', () => {});
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return {
      url: `ws://127.0.0.1:${port}`,
      connections: () => accepted,
      close: () => new Promise((resolve) => { held.forEach((s) => s.destroy()); server.close(() => resolve()); }),
    };
  }
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  let upgraded = 0;
  const timers: ReturnType<typeof setInterval>[] = [];
  wss.on('connection', (client: WebSocket) => {
    upgraded++;
    if (behaviour === 'ws-mute') return; // handshake done, then nothing
    client.on('message', (raw) => {
      const frame = String(raw);
      const reply = venue.pong(frame) ?? venue.ack(frame);
      if (reply !== null && client.readyState === WebSocket.OPEN) client.send(reply);
    });
    if (behaviour === 'liveness-only') {
      const t = setInterval(() => client.readyState === WebSocket.OPEN && client.send(venue.liveness()), 30);
      timers.push(t);
      client.on('close', () => clearInterval(t));
    }
  });
  const { port } = wss.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}`,
    connections: () => upgraded,
    close: () =>
      new Promise((resolve) => {
        timers.forEach(clearInterval);
        wss.clients.forEach((c) => c.terminate());
        wss.close(() => resolve());
      }),
  };
}

/** Runs the client against the server for `ms`, ticking the dead-socket rule as the services do. */
async function drive(venue: Venue, behaviour: Behaviour, ms: number) {
  const server = await serve(venue, behaviour);
  const errors: string[] = [];
  let fired = 0;
  const client = venue.open(server.url, (m) => errors.push(m));
  const tick = setInterval(() => { if (client.check()) fired++; }, TICK_MS);
  await new Promise((resolve) => setTimeout(resolve, ms));
  clearInterval(tick);
  client.stop();
  const connections = server.connections();
  await server.close();
  return { fired, connections, errors };
}

describe.each([BYBIT, OKX])('IB-BUG-051 — $name dead-socket rule against a real socket', (venue) => {
  it('tcp-mute: a server that accepts and never answers the handshake is reconnected', async () => {
    const r = await drive(venue, 'tcp-mute', WINDOW_MS);
    expect(r.fired).toBeGreaterThanOrEqual(1);
    expect(r.connections).toBeGreaterThanOrEqual(2);
    expect(r.errors.some((e) => /reconnecting/.test(e))).toBe(true);
  });

  it('ws-mute: a socket that opens and then sends nothing is reconnected', async () => {
    const r = await drive(venue, 'ws-mute', WINDOW_MS);
    expect(r.fired).toBeGreaterThanOrEqual(1);
    expect(r.connections).toBeGreaterThanOrEqual(2);
  });

  it('pong-only: acks and pongs are not venue data — a route where no topic delivers is reconnected', async () => {
    const r = await drive(venue, 'pong-only', WINDOW_MS);
    expect(r.fired).toBeGreaterThanOrEqual(1);
    expect(r.connections).toBeGreaterThanOrEqual(2);
  });

  it('control: liveness flowing while liquidations are silent is a quiet market, NOT a reconnect', async () => {
    const r = await drive(venue, 'liveness-only', WINDOW_MS);
    expect(r.fired).toBe(0);
    expect(r.connections).toBe(1);
  });
});
