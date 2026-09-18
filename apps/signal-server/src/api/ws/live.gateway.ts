import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import type { Server } from 'ws';
import {
  Candle,
  InstrumentId,
  MetricKind,
  MetricPoint,
  Signal,
  TIMEFRAME_MS,
  Timeframe,
  WsClientMessage,
  WsClientMessageSchema,
  WsServerMessage,
  bucketObservations,
} from '@trade-automation/contracts';
import { CandleClosedEvent, CandleFormingEvent, MarketDataEvents } from '../../market-data/market-data.events';
import { MarketDataStatusService } from '../../market-data/market-data-status.service';
import { MetricCache } from '../../market-data/metrics/metric-cache.service';
import { MetricEvents, MetricObservedEvent } from '../../market-data/metrics/metric.events';
import {
  IndicatorEmittedEvent,
  SignalEmittedEvent,
  StrategyEngineEvents,
} from '../../strategy-engine/strategy-engine.events';
import { AppConfigService } from '../../config/config.service';
import { MetricsService } from '../../observability/metrics.service';
import {
  CalendarEventChangedEvent,
  CalendarEvents,
  CalendarNotificationFiredEvent,
} from '../../calendar/calendar.events';

// architecture/live-signal-server.md §3.5 — "Forming-bar frames are throttled server-side to
// at most ~4/s per topic; the chart does not need every Binance kline tick."
const FORMING_THROTTLE_MS = 250;

interface ClientState {
  candleTopics: Set<string>; // `${instrument}|${timeframe}`
  signalTopics: Set<InstrumentId>;
  /** architecture/chart-layouts.md §4.5 — `${instrument}|${metric}|${timeframe}`. */
  metricTopics: Set<string>;
  /** architecture/economic-calendar.md §6.2 — no parameters, one stream for the whole calendar. */
  calendar: boolean;
}

type WsSocket = {
  readyState: number;
  send(data: string): void;
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: () => void): void;
};

/**
 * architecture/live-signal-server.md §3.5, §4.5 — plain JSON frames on the native `ws` adapter
 * (no socket.io). Auth: optional shared token via a query param (`?token=`), checked only if
 * `WS_SHARED_TOKEN` is configured — a cheap gate DevOps can enable without a code change.
 */
@WebSocketGateway()
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LiveGateway.name);

  @WebSocketServer()
  server!: Server;

  private readonly clients = new Map<WsSocket, ClientState>();
  private readonly lastFormingSentAt = new Map<string, number>();

  constructor(
    private readonly status: MarketDataStatusService,
    private readonly config: AppConfigService,
    private readonly metrics: MetricsService,
    private readonly metricCache: MetricCache,
  ) {}

  handleConnection(client: WsSocket, request: IncomingMessage): void {
    const sharedToken = this.config.env.get('WS_SHARED_TOKEN');
    if (sharedToken) {
      const url = new URL(request.url ?? '', 'http://localhost');
      if (url.searchParams.get('token') !== sharedToken) {
        client.send(JSON.stringify({ type: 'error', message: 'unauthorized' }));
        (client as unknown as { close: () => void }).close?.();
        return;
      }
    }

    this.clients.set(client, {
      candleTopics: new Set(),
      signalTopics: new Set(),
      metricTopics: new Set(),
      calendar: false,
    });
    this.metrics.wsClients.set(this.clients.size);
    client.on('message', (data) => this.onMessage(client, data));
    client.on('close', () => {
      this.clients.delete(client);
      this.metrics.wsClients.set(this.clients.size);
    });
  }

  handleDisconnect(client: WsSocket): void {
    this.clients.delete(client);
    this.metrics.wsClients.set(this.clients.size);
  }

  private onMessage(client: WsSocket, raw: unknown): void {
    let parsed: WsClientMessage;
    try {
      const json = JSON.parse(String(raw));
      parsed = WsClientMessageSchema.parse(json);
    } catch (err) {
      this.send(client, { type: 'error', message: `invalid message: ${(err as Error).message}` } as never);
      return;
    }

    const state = this.clients.get(client);
    if (!state) return;

    switch (parsed.type) {
      case 'ping':
        this.send(client, { type: 'pong', serverTime: Date.now() });
        break;
      case 'subscribe':
        if (parsed.topic === 'candles') {
          state.candleTopics.add(this.candleKey(parsed.instrument, parsed.timeframe));
        } else if (parsed.topic === 'metrics') {
          state.metricTopics.add(this.metricKey(parsed.instrument, parsed.metric, parsed.timeframe));
        } else if (parsed.topic === 'calendar') {
          state.calendar = true;
        } else if (parsed.topic === 'metricAggregates') {
          // architecture/aggregate-oi.md §5 — accepted by the contract, served by SE-AG3.
        } else {
          state.signalTopics.add(parsed.instrument);
        }
        break;
      case 'unsubscribe':
        if (parsed.topic === 'candles') {
          state.candleTopics.delete(this.candleKey(parsed.instrument, parsed.timeframe));
        } else if (parsed.topic === 'metrics') {
          state.metricTopics.delete(this.metricKey(parsed.instrument, parsed.metric, parsed.timeframe));
        } else if (parsed.topic === 'calendar') {
          state.calendar = false;
        } else if (parsed.topic === 'metricAggregates') {
          // architecture/aggregate-oi.md §5 — accepted by the contract, served by SE-AG3.
        } else {
          state.signalTopics.delete(parsed.instrument);
        }
        break;
    }
  }

  private candleKey(instrument: InstrumentId, timeframe: Timeframe): string {
    return `${instrument}|${timeframe}`;
  }

  private metricKey(instrument: InstrumentId, metric: MetricKind, timeframe: Timeframe): string {
    return `${instrument}|${metric}|${timeframe}`;
  }

  private send(client: WsSocket, message: WsServerMessage | { type: 'error'; message: string }): void {
    try {
      client.send(JSON.stringify(message));
      this.metrics.wsFramesSent.inc({ frameType: message.type });
    } catch (err) {
      this.logger.debug(`Failed to send WS frame: ${(err as Error).message}`);
    }
  }

  @OnEvent(MarketDataEvents.CandleForming)
  onCandleForming(event: CandleFormingEvent): void {
    const candle = event.candle;
    const topic = this.candleKey(candle.instrument, candle.timeframe);
    const now = Date.now();
    const lastSent = this.lastFormingSentAt.get(topic) ?? 0;
    if (now - lastSent < FORMING_THROTTLE_MS) return;
    this.lastFormingSentAt.set(topic, now);
    this.broadcastCandle(topic, candle);
  }

  @OnEvent(MarketDataEvents.CandleClosed)
  onCandleClosed(event: CandleClosedEvent): void {
    const candle = event.candle;
    const topic = this.candleKey(candle.instrument, candle.timeframe);
    this.broadcastCandle(topic, candle);

    const instrumentStatus = this.status.get(candle.instrument);
    for (const [client, state] of this.clients) {
      if (state.candleTopics.has(topic) || state.signalTopics.has(candle.instrument)) {
        this.send(client, {
          type: 'status',
          instrument: candle.instrument,
          venueStatus: instrumentStatus.venueStatus,
          lastClosedCandleTime: instrumentStatus.lastClosedCandleTime,
        });
      }
    }
  }

  @OnEvent(StrategyEngineEvents.SignalEmitted)
  onSignalEmitted(event: SignalEmittedEvent): void {
    const signal = event.signal;
    for (const [client, state] of this.clients) {
      if (state.signalTopics.has(signal.instrument)) {
        this.send(client, { type: 'signal', signal });
      }
    }
  }

  /** architecture/live-signal-server.md §11.5 — no new client->server verb: indicator points
   * ride the existing `signals` topic subscription. */
  @OnEvent(StrategyEngineEvents.IndicatorEmitted)
  onIndicatorEmitted(event: IndicatorEmittedEvent): void {
    const point = event.point;
    for (const [client, state] of this.clients) {
      if (state.signalTopics.has(point.instrument)) {
        this.send(client, { type: 'indicator', point });
      }
    }
  }

  /**
   * architecture/chart-layouts.md §4.5 — "ClientState gains metricTopics ... and
   * onMetricObserved fans one bucketed point per subscribed timeframe." At <=1 observation/min
   * no throttle is needed, unlike candle forming frames.
   *
   * §11.2: the point is built from MetricCache over [bucketStart − tfMs, observation.time] — the
   * bucket so far plus its predecessor (for the open) — never from the single observation, which
   * would replace the forming candle with a flat one on every poll. Same inputs as the REST path,
   * so the WS point for a bucket equals the REST point for it.
   */
  @OnEvent(MetricEvents.MetricObserved)
  onMetricObserved(event: MetricObservedEvent): void {
    const observation = event.observation;
    const pointByTimeframe = new Map<Timeframe, MetricPoint | null>();

    for (const [client, state] of this.clients) {
      for (const topic of state.metricTopics) {
        const [topicInstrument, topicMetric, topicTimeframe] = topic.split('|') as [
          InstrumentId,
          MetricKind,
          Timeframe,
        ];
        if (topicInstrument !== observation.instrument || topicMetric !== observation.metric) continue;

        let point = pointByTimeframe.get(topicTimeframe);
        if (point === undefined) {
          point = this.formingMetricPoint(observation, topicTimeframe);
          pointByTimeframe.set(topicTimeframe, point);
        }
        if (point) this.send(client, { type: 'metric', point });
      }
    }
  }

  private formingMetricPoint(observation: MetricObservedEvent['observation'], tf: Timeframe): MetricPoint | null {
    const tfMs = TIMEFRAME_MS[tf];
    const bucketStart = Math.floor(observation.time / tfMs) * tfMs;
    const window = this.metricCache.query(observation.instrument, observation.metric, bucketStart - tfMs, observation.time);
    const last = bucketObservations(window, tf).at(-1);
    return last && last.time === bucketStart ? last : null;
  }

  private broadcastCandle(topic: string, candle: Candle): void {
    for (const [client, state] of this.clients) {
      if (state.candleTopics.has(topic)) {
        this.send(client, { type: 'candle', candle });
      }
    }
  }

  /** architecture/economic-calendar.md §6.2 — fans a created/updated/removed/actual change to every `calendar`-subscribed client. */
  @OnEvent(CalendarEvents.EventChanged)
  onCalendarEventChanged(event: CalendarEventChangedEvent): void {
    for (const [client, state] of this.clients) {
      if (state.calendar) {
        this.send(client, { type: 'calendarEvent', event: event.event, change: event.change });
      }
    }
  }

  /** architecture/economic-calendar.md §5, §6.2 — a fired daily-digest or event-due notification. */
  @OnEvent(CalendarEvents.NotificationFired)
  onCalendarNotificationFired(event: CalendarNotificationFiredEvent): void {
    for (const [client, state] of this.clients) {
      if (state.calendar) {
        this.send(client, { type: 'notification', notification: event.notification });
      }
    }
  }
}
