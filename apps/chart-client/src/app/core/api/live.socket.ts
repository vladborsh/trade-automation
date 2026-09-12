import { Injectable, OnDestroy } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import type {
  InstrumentId,
  Timeframe,
  WsCandleFrame,
  WsClientFrame,
  WsServerFrame,
  WsSignalFrame,
  WsStatusFrame,
} from '../contracts/contracts';
import { browserSocketFactory, SOCKET_OPEN, type SocketFactory, type SocketLike } from './socket-factory';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';

interface CandleTopicKey {
  topic: 'candles';
  instrument: InstrumentId;
  timeframe: Timeframe;
}

interface SignalTopicKey {
  topic: 'signals';
  instrument: InstrumentId;
}

type TopicKey = CandleTopicKey | SignalTopicKey;

function topicKeyId(key: TopicKey): string {
  return key.topic === 'candles' ? `candles:${key.instrument}:${key.timeframe}` : `signals:${key.instrument}`;
}

const PING_INTERVAL_MS = 20_000;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

/**
 * One WebSocket connection for the whole app. Instrument/timeframe switches
 * are subscription churn on this one socket (§5.3) — never a reconnect.
 *
 * On an actual drop, reconnects with exponential backoff, re-subscribes to
 * every previously active topic, and emits on `reconnected$` so consumers
 * (candles.store) know to re-fetch history from their last known openTime —
 * the client never assumes it missed nothing (§5.3 step 5).
 */
@Injectable({ providedIn: 'root' })
export class LiveSocket implements OnDestroy {
  private socket: SocketLike | null = null;
  private url = '';
  private factory: SocketFactory = browserSocketFactory;
  private readonly activeTopics = new Map<string, TopicKey>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private hasConnectedBefore = false;

  private readonly frames$ = new Subject<WsServerFrame>();
  private readonly connectionState$$ = new Subject<ConnectionState>();
  private readonly reconnected$$ = new Subject<void>();

  readonly candleFrames$: Observable<WsCandleFrame> = this.frames$.pipe(
    filter((f): f is WsCandleFrame => f.type === 'candle'),
  );
  readonly signalFrames$: Observable<WsSignalFrame> = this.frames$.pipe(
    filter((f): f is WsSignalFrame => f.type === 'signal'),
  );
  readonly statusFrames$: Observable<WsStatusFrame> = this.frames$.pipe(
    filter((f): f is WsStatusFrame => f.type === 'status'),
  );
  readonly connectionState: Observable<ConnectionState> = this.connectionState$$.asObservable();
  /** Emits once a reconnect finishes re-subscribing; a cue to re-fetch and heal gaps. */
  readonly reconnected: Observable<void> = this.reconnected$$.asObservable();

  /** Test-only seam: swap the real WebSocket for a fake before calling connect(). */
  useSocketFactory(factory: SocketFactory): void {
    this.factory = factory;
  }

  connect(url: string): void {
    this.url = url;
    this.destroyed = false;
    this.openSocket();
  }

  private openSocket(): void {
    this.connectionState$$.next(this.hasConnectedBefore ? 'reconnecting' : 'connecting');
    const socket = this.factory(this.url);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.connectionState$$.next('live');
      this.startPing();
      // Always resend active topics on open: on first connect this flushes
      // subscribes that were requested before the socket was ready; on a
      // real reconnect it also restores what was active before the drop.
      this.resubscribeAll();
      if (this.hasConnectedBefore) {
        this.reconnected$$.next();
      }
      this.hasConnectedBefore = true;
    };

    socket.onmessage = (event: { data: string }) => {
      try {
        const frame = JSON.parse(event.data) as WsServerFrame;
        this.frames$.next(frame);
      } catch {
        // malformed frame from server: drop it, do not crash the client
      }
    };

    socket.onclose = () => {
      this.stopPing();
      if (this.destroyed) {
        return;
      }
      this.connectionState$$.next('reconnecting');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose follows onerror for browser WebSocket; no separate handling needed
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** this.reconnectAttempt, MAX_BACKOFF_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.destroyed) {
        this.openSocket();
      }
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ type: 'ping' }), PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private send(frame: WsClientFrame): void {
    if (this.socket && this.socket.readyState === SOCKET_OPEN) {
      this.socket.send(JSON.stringify(frame));
    }
  }

  private resubscribeAll(): void {
    for (const key of this.activeTopics.values()) {
      this.sendSubscribe(key);
    }
  }

  private sendSubscribe(key: TopicKey): void {
    if (key.topic === 'candles') {
      this.send({ type: 'subscribe', topic: 'candles', instrument: key.instrument, timeframe: key.timeframe });
    } else {
      this.send({ type: 'subscribe', topic: 'signals', instrument: key.instrument });
    }
  }

  subscribeCandles(instrument: InstrumentId, timeframe: Timeframe): void {
    const key: TopicKey = { topic: 'candles', instrument, timeframe };
    this.activeTopics.set(topicKeyId(key), key);
    this.sendSubscribe(key);
  }

  unsubscribeCandles(instrument: InstrumentId, timeframe: Timeframe): void {
    const key: TopicKey = { topic: 'candles', instrument, timeframe };
    this.activeTopics.delete(topicKeyId(key));
    this.send({ type: 'unsubscribe', topic: 'candles', instrument, timeframe });
  }

  subscribeSignals(instrument: InstrumentId): void {
    const key: TopicKey = { topic: 'signals', instrument };
    this.activeTopics.set(topicKeyId(key), key);
    this.sendSubscribe(key);
  }

  unsubscribeSignals(instrument: InstrumentId): void {
    const key: TopicKey = { topic: 'signals', instrument };
    this.activeTopics.delete(topicKeyId(key));
    this.send({ type: 'unsubscribe', topic: 'signals', instrument });
  }

  candlesFor(instrument: InstrumentId, timeframe: Timeframe): Observable<WsCandleFrame> {
    return this.candleFrames$.pipe(
      filter((f) => f.candle.instrument === instrument && f.candle.timeframe === timeframe),
    );
  }

  signalsFor(instrument: InstrumentId): Observable<WsSignalFrame> {
    return this.signalFrames$.pipe(
      map((f) => f),
      filter((f) => f.signal.instrument === instrument),
    );
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
  }
}
