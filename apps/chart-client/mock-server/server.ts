import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  Candle,
  HealthResponse,
  IndicatorPoint,
  InstrumentId,
  InstrumentsResponse,
  Layout,
  MetricKind,
  MetricObservation,
  MetricPoint,
  Signal,
  StrategiesResponse,
  Timeframe,
  WsClientMessage,
  WsServerMessage,
} from '@trade-automation/contracts';
import { bucketObservations } from '@trade-automation/contracts';
import { MockMarketState } from './state';
import { MOCK_LAYOUTS } from './layouts';
import { VWAP_BAND_STRATEGY_ID } from './vwap-band-mock';
import { MockCalendarState } from './calendar-state';
import type { CalendarServerFrame } from './calendar-types';

const PORT = Number(process.env.MOCK_SERVER_PORT ?? 4300);
const BAR_MS = Number(process.env.MOCK_BAR_MS ?? 2000);
const FORMING_FRAME_MIN_INTERVAL_MS = 250; // ~4/s per topic, per §4.5

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

const state = new MockMarketState(BAR_MS);
const calendarNotificationIntervalMs = Number(process.env.MOCK_CALENDAR_NOTIFICATION_INTERVAL_MS ?? 180_000);
const calendarNotificationFirstDelayMs = Number(process.env.MOCK_CALENDAR_NOTIFICATION_FIRST_DELAY_MS ?? 20_000);
const calendarState = new MockCalendarState(Date.now(), calendarNotificationIntervalMs, calendarNotificationFirstDelayMs);

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

function isCapitalCom(id: InstrumentId): boolean {
  return id.startsWith('capitalcom:');
}

/**
 * architecture/vwap-band-reversal-plugin.md §8.2 step 1 — strategies list
 * with tier/displayName/description/minBars/indicators, mirroring §11.4 of
 * live-signal-server.md. The mock ships the research strategy `enabled:
 * true` (unlike the real server's `enabled: false` default) so the client's
 * labelling and indicator plumbing have something to render against
 * end-to-end without a config flip.
 */
function strategiesResponse(): StrategiesResponse {
  const capitalComInstruments = state.instruments.filter((i) => isCapitalCom(i.id)).map((i) => i.id);
  return [
    {
      id: 'example-cross',
      enabled: true,
      instruments: state.instruments.map((i) => i.id),
      timeframe: '1m',
      warmupBars: 20,
      status: 'live',
      tier: 'demo',
      displayName: 'Example cross (demo)',
      description: 'Proves the overlay pipeline end to end. Never a strategy of this project.',
    },
    {
      id: VWAP_BAND_STRATEGY_ID,
      enabled: true,
      instruments: capitalComInstruments,
      timeframe: '1m',
      warmupBars: 1440,
      status: 'live',
      tier: 'research',
      displayName: 'VWAP band reversal (cmc-bot port)',
      description: 'Unvalidated. Port of the cmc-bot VWAP band-reversal mechanic; markers show where it fires, not trades.',
      minBars: 1,
      indicators: [
        {
          id: 'vwap-band',
          label: 'VWAP band (research, unvalidated)',
          scale: 'price',
          keys: [
            { key: 'vwap', label: 'VWAP', color: '#d29922' },
            { key: 'vwapTop', label: 'VWAP +1σ', color: '#d29922', style: 'dashed' },
            { key: 'vwapBottom', label: 'VWAP −1σ', color: '#d29922', style: 'dashed' },
          ],
        },
      ],
    },
  ];
}

function healthResponse(): HealthResponse {
  return {
    status: 'ok',
    uptimeSeconds: (Date.now() - state.bootTime) / 1000,
    instruments: state.instruments.map((instrument) => {
      const lastOpenTime = state.lastClosedOpenTime(instrument.id);
      return {
        instrument: instrument.id,
        lastClosedCandleAge: lastOpenTime !== null ? Date.now() - lastOpenTime : null,
        gapCount24h: 0,
        feedLag: 0,
      };
    }),
  };
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
    const body: InstrumentsResponse = state.instruments.map((instrument) => ({
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

  if (url.pathname === '/api/indicators') {
    const instrument = url.searchParams.get('instrument') as InstrumentId | null;
    if (!instrument) {
      sendJson(res, 400, { error: 'instrument is required' });
      return;
    }
    const from = parseNumber(url.searchParams.get('from'));
    const to = parseNumber(url.searchParams.get('to'));
    const strategyId = url.searchParams.get('strategyId') ?? undefined;
    const body: IndicatorPoint[] = state.indicatorsFor(instrument, from, to, strategyId);
    sendJson(res, 200, body);
    return;
  }

  if (url.pathname === '/api/strategies') {
    sendJson(res, 200, strategiesResponse());
    return;
  }

  if (url.pathname === '/api/layouts') {
    const body: Layout[] = MOCK_LAYOUTS;
    sendJson(res, 200, body);
    return;
  }

  if (url.pathname === '/api/metrics') {
    const instrument = url.searchParams.get('instrument') as InstrumentId | null;
    const metric = url.searchParams.get('metric') as MetricKind | null;
    const timeframe = url.searchParams.get('timeframe') as Timeframe | null;
    if (!instrument || !metric || !timeframe || !TIMEFRAMES.includes(timeframe)) {
      sendJson(res, 400, { error: 'instrument, metric and a valid timeframe are required' });
      return;
    }
    const from = parseNumber(url.searchParams.get('from'));
    const to = parseNumber(url.searchParams.get('to'));
    const limit = Math.min(parseNumber(url.searchParams.get('limit')) ?? 1500, 5000);
    const body: MetricPoint[] = state.metrics(instrument, metric, timeframe, from, to, limit);
    sendJson(res, 200, body);
    return;
  }

  if (url.pathname === '/api/health') {
    sendJson(res, 200, healthResponse());
    return;
  }

  if (url.pathname === '/api/calendar/week') {
    const at = parseNumber(url.searchParams.get('at'));
    sendJson(res, 200, calendarState.weekResponse(at));
    return;
  }

  if (url.pathname === '/api/calendar/events') {
    const from = parseNumber(url.searchParams.get('from')) ?? calendarState.weekFrom;
    const to = parseNumber(url.searchParams.get('to')) ?? calendarState.weekTo;
    sendJson(res, 200, calendarState.eventsInRange(from, to));
    return;
  }

  if (url.pathname.startsWith('/api/calendar/events/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/calendar/events/'.length));
    const detail = calendarState.eventDetail(id);
    if (!detail) {
      sendJson(res, 404, { error: 'event not found' });
      return;
    }
    sendJson(res, 200, detail);
    return;
  }

  if (url.pathname === '/api/calendar/notifications') {
    const from = parseNumber(url.searchParams.get('from')) ?? 0;
    const limit = Math.min(parseNumber(url.searchParams.get('limit')) ?? 50, 200);
    sendJson(res, 200, calendarState.notificationsSince(from, limit));
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

const httpServer = createServer(handleRequest);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

interface MetricTopicKey {
  instrument: InstrumentId;
  metric: MetricKind;
  timeframe: Timeframe;
}

function metricTopicId(key: MetricTopicKey): string {
  return `${key.instrument}:${key.metric}:${key.timeframe}`;
}

interface ClientSubscriptions {
  candles: Set<string>; // `${instrument}:${timeframe}`
  signals: Set<InstrumentId>;
  metrics: Map<string, MetricTopicKey>; // `${instrument}:${metric}:${timeframe}` -> key
  calendar: boolean;
}

wss.on('connection', (socket: WebSocket) => {
  const subscriptions: ClientSubscriptions = { candles: new Set(), signals: new Set(), metrics: new Map(), calendar: false };
  const lastFormingSentAt = new Map<string, number>();

  const send = (frame: WsServerMessage | CalendarServerFrame): void => {
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

  // `indicator` frames ride the same `signals` topic subscription — no new
  // client→server verb (architecture/vwap-band-reversal-plugin.md §3.1).
  const unsubscribeIndicators = state.onIndicator((point) => {
    if (subscriptions.signals.has(point.instrument)) {
      send({ type: 'indicator', point });
    }
  });

  /**
   * architecture/chart-layouts.md §4.5 — one frame per observation, bucketed
   * to EACH subscriber's own requested timeframe (a client on '5m' and one
   * on '1m' both subscribed to the same instrument/metric get their own
   * correctly-bucketed point from the same raw observation).
   */
  const unsubscribeMetrics = state.onMetric((observation: MetricObservation) => {
    for (const key of subscriptions.metrics.values()) {
      if (key.instrument !== observation.instrument || key.metric !== observation.metric) {
        continue;
      }
      const [point] = bucketObservations([observation], key.timeframe);
      if (point) {
        send({ type: 'metric', point });
      }
    }
  });

  const unsubscribeCalendarEvents = calendarState.onCalendarEvent((event, change) => {
    if (subscriptions.calendar) {
      send({ type: 'calendarEvent', event, change });
    }
  });

  const unsubscribeCalendarNotifications = calendarState.onNotification((notification) => {
    if (subscriptions.calendar) {
      send({ type: 'notification', notification });
    }
  });

  socket.on('message', (raw: Buffer) => {
    let frame: WsClientMessage | { type: 'subscribe' | 'unsubscribe'; topic: 'calendar' };
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
      return;
    }
    if (frame.type === 'subscribe' && frame.topic === 'metrics') {
      const key: MetricTopicKey = { instrument: frame.instrument, metric: frame.metric, timeframe: frame.timeframe };
      subscriptions.metrics.set(metricTopicId(key), key);
      return;
    }
    if (frame.type === 'unsubscribe' && frame.topic === 'metrics') {
      subscriptions.metrics.delete(metricTopicId({ instrument: frame.instrument, metric: frame.metric, timeframe: frame.timeframe }));
      return;
    }
    if (frame.type === 'subscribe' && frame.topic === 'calendar') {
      subscriptions.calendar = true;
      return;
    }
    if (frame.type === 'unsubscribe' && frame.topic === 'calendar') {
      subscriptions.calendar = false;
    }
  });

  socket.on('close', () => {
    unsubscribeCandles();
    unsubscribeSignals();
    unsubscribeIndicators();
    unsubscribeMetrics();
    unsubscribeCalendarEvents();
    unsubscribeCalendarNotifications();
  });
});

state.start();
calendarState.start();

httpServer.listen(PORT, () => {
  console.log(`[mock-server] listening on http://localhost:${PORT} (REST) and ws://localhost:${PORT}/ws (WS)`);
});
