import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  Candle,
  Health,
  InstrumentId,
  InstrumentWithStatus,
  Signal,
  StrategyInfo,
  Timeframe,
  WsClientFrame,
  WsServerFrame,
} from '../src/app/core/contracts/contracts';
import { MockMarketState } from './state';

const PORT = Number(process.env.MOCK_SERVER_PORT ?? 4300);
const BAR_MS = Number(process.env.MOCK_BAR_MS ?? 2000);
const FORMING_FRAME_MIN_INTERVAL_MS = 250; // ~4/s per topic, per §4.5

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

const state = new MockMarketState(BAR_MS);

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function parseNumber(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  if (url.pathname === '/api/instruments') {
    const body: InstrumentWithStatus[] = state.instruments.map((instrument) => ({
      ...instrument,
      venueStatus: state.venueStatusFor(instrument.id),
    }));
    sendJson(res, 200, body);
    return;
  }

  if (url.pathname === '/api/candles') {
    const instrument = url.searchParams.get('instrument') as InstrumentId | null;
    const timeframe = url.searchParams.get('timeframe') as Timeframe | null;
    if (!instrument || !timeframe || !TIMEFRAMES.includes(timeframe)) {
      sendJson(res, 400, { error: 'instrument and a valid timeframe are required' });
      return;
    }
    const from = parseNumber(url.searchParams.get('from'));
    const to = parseNumber(url.searchParams.get('to'));
    const limit = Math.min(parseNumber(url.searchParams.get('limit')) ?? 1500, 5000);
    const body: Candle[] = state.candles(instrument, timeframe, from, to, limit);
    sendJson(res, 200, body);
    return;
  }

  if (url.pathname === '/api/signals') {
    const instrument = url.searchParams.get('instrument') as InstrumentId | null;
    if (!instrument) {
      sendJson(res, 400, { error: 'instrument is required' });
      return;
    }
    const from = parseNumber(url.searchParams.get('from'));
    const to = parseNumber(url.searchParams.get('to'));
    const strategyId = url.searchParams.get('strategyId') ?? undefined;
    const body: Signal[] = state.signalsFor(instrument, from, to, strategyId);
    sendJson(res, 200, body);
    return;
  }

  if (url.pathname === '/api/strategies') {
    const body: StrategyInfo[] = [
      {
        id: 'example-cross',
        enabled: true,
        instruments: state.instruments.map((i) => i.id),
        timeframe: '1m',
        warmupBars: 20,
        status: 'live',
      },
    ];
    sendJson(res, 200, body);
    return;
  }

  if (url.pathname === '/api/health') {
    const body: Health = {
      ok: true,
      instruments: state.instruments.map((instrument) => {
        const lastOpenTime = state.lastClosedOpenTime(instrument.id);
        return {
          instrument: instrument.id,
          lastClosedCandleAge: lastOpenTime !== null ? Date.now() - lastOpenTime : -1,
          gapCount24h: 0,
          feedLag: 0,
        };
      }),
    };
    sendJson(res, 200, body);
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

const httpServer = createServer(handleRequest);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

interface ClientSubscriptions {
  candles: Set<string>; // `${instrument}:${timeframe}`
  signals: Set<InstrumentId>;
}

wss.on('connection', (socket: WebSocket) => {
  const subscriptions: ClientSubscriptions = { candles: new Set(), signals: new Set() };
  const lastFormingSentAt = new Map<string, number>();

  const send = (frame: WsServerFrame): void => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
    }
  };

  const unsubscribeCandles = state.onCandle((candle) => {
    const key = `${candle.instrument}:${candle.timeframe}`;
    if (!subscriptions.candles.has(key)) {
      return;
    }
    if (!candle.closed) {
      const last = lastFormingSentAt.get(key) ?? 0;
      const now = Date.now();
      if (now - last < FORMING_FRAME_MIN_INTERVAL_MS) {
        return;
      }
      lastFormingSentAt.set(key, now);
    }
    send({ type: 'candle', candle });
  });

  const unsubscribeSignals = state.onSignal((signal) => {
    if (subscriptions.signals.has(signal.instrument)) {
      send({ type: 'signal', signal });
    }
  });

  socket.on('message', (raw: Buffer) => {
    let frame: WsClientFrame;
    try {
      frame = JSON.parse(raw.toString('utf-8'));
    } catch {
      return;
    }

    if (frame.type === 'ping') {
      send({ type: 'pong', serverTime: Date.now() });
      return;
    }

    if (frame.type === 'subscribe' && frame.topic === 'candles') {
      subscriptions.candles.add(`${frame.instrument}:${frame.timeframe}`);
      send({
        type: 'status',
        instrument: frame.instrument,
        venueStatus: state.venueStatusFor(frame.instrument),
        lastClosedCandleTime: state.lastClosedOpenTime(frame.instrument),
      });
      return;
    }
    if (frame.type === 'unsubscribe' && frame.topic === 'candles') {
      subscriptions.candles.delete(`${frame.instrument}:${frame.timeframe}`);
      return;
    }
    if (frame.type === 'subscribe' && frame.topic === 'signals') {
      subscriptions.signals.add(frame.instrument);
      return;
    }
    if (frame.type === 'unsubscribe' && frame.topic === 'signals') {
      subscriptions.signals.delete(frame.instrument);
    }
  });

  socket.on('close', () => {
    unsubscribeCandles();
    unsubscribeSignals();
  });
});

state.start();

httpServer.listen(PORT, () => {
  console.log(`[mock-server] listening on http://localhost:${PORT} (REST) and ws://localhost:${PORT}/ws (WS)`);
});
