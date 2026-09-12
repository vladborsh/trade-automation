/**
 * Shared wire-contract types, mirroring architecture/live-signal-server.md §3.
 *
 * NOTE: libs/contracts did not exist on disk when this app was built (SE-1's
 * territory, built in parallel). These types are a local stand-in so the
 * client and mock-server can build against a fixed contract now. Once SE-1
 * lands `libs/contracts`, these should be deleted and replaced with imports
 * from that package — the shapes here are written to match §3 verbatim so
 * that swap should be mechanical (see REPORT.md).
 */

export type Venue = 'binance' | 'capitalcom';
export type InstrumentId = `${Venue}:${string}`;

export interface Instrument {
  id: InstrumentId;
  venue: Venue;
  symbol: string;
  assetClass: 'crypto-perp' | 'index-cfd' | 'forex-cfd' | 'equity';
  displayName: string;
  pricePrecision: number;
  quoteCurrency: string;
  sessionTimezone: string;
}

export type VenueStatus = 'up' | 'degraded' | 'down' | 'closed';

export interface InstrumentWithStatus extends Instrument {
  venueStatus: VenueStatus;
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export type CandleSource = 'venue-stream' | 'venue-rest' | 'venue-native' | 'resampled' | 'storage';

export interface OhlcQuad {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Candle {
  instrument: InstrumentId;
  timeframe: Timeframe;
  openTime: number; // ms since epoch, UTC, exchange-stamped bar start
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
  source: CandleSource;
  bid?: OhlcQuad;
  ask?: OhlcQuad;
}

export type SignalKind = 'entry' | 'exit' | 'info';
export type Direction = 'long' | 'short' | 'flat';

export type OverlayPrimitive =
  | { type: 'marker'; time: number; position: 'above' | 'below'; shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'; color?: string; text?: string }
  | { type: 'priceLine'; price: number; from?: number; to?: number; style?: 'solid' | 'dashed'; color?: string; label?: string }
  | { type: 'ray'; time: number; price: number; color?: string; label?: string }
  | { type: 'rect'; from: number; to: number; top: number; bottom: number; color?: string; label?: string }
  | { type: 'line'; points: Array<{ time: number; price: number }>; color?: string; label?: string };

export interface Signal {
  id: string;
  strategyId: string;
  instrument: InstrumentId;
  timeframe: Timeframe;
  time: number; // openTime of the bar that produced it
  kind: SignalKind;
  direction: Direction;
  levels?: { entry?: number; stop?: number; target?: number };
  confidence?: number;
  overlay: OverlayPrimitive[];
  meta: Record<string, string | number | boolean>;
}

export type StrategyStatus = 'warming' | 'live' | 'error';

export interface StrategyInfo {
  id: string;
  enabled: boolean;
  instruments: InstrumentId[];
  timeframe: Timeframe;
  warmupBars: number;
  status: StrategyStatus;
}

export interface HealthInstrumentStatus {
  instrument: InstrumentId;
  lastClosedCandleAge: number;
  gapCount24h: number;
  feedLag: number;
}

export interface Health {
  ok: boolean;
  instruments: HealthInstrumentStatus[];
}

// --- WebSocket frames (§3.5) ---

export interface WsSubscribeCandles {
  type: 'subscribe';
  topic: 'candles';
  instrument: InstrumentId;
  timeframe: Timeframe;
}

export interface WsUnsubscribeCandles {
  type: 'unsubscribe';
  topic: 'candles';
  instrument: InstrumentId;
  timeframe: Timeframe;
}

export interface WsSubscribeSignals {
  type: 'subscribe';
  topic: 'signals';
  instrument: InstrumentId;
}

export interface WsUnsubscribeSignals {
  type: 'unsubscribe';
  topic: 'signals';
  instrument: InstrumentId;
}

export interface WsPing {
  type: 'ping';
}

export type WsClientFrame =
  | WsSubscribeCandles
  | WsUnsubscribeCandles
  | WsSubscribeSignals
  | WsUnsubscribeSignals
  | WsPing;

export interface WsCandleFrame {
  type: 'candle';
  candle: Candle;
}

export interface WsSignalFrame {
  type: 'signal';
  signal: Signal;
}

export interface WsStatusFrame {
  type: 'status';
  instrument: InstrumentId;
  venueStatus: VenueStatus;
  lastClosedCandleTime: number | null;
}

export interface WsPongFrame {
  type: 'pong';
  serverTime: number;
}

export type WsServerFrame = WsCandleFrame | WsSignalFrame | WsStatusFrame | WsPongFrame;
