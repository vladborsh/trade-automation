/**
 * Ergonomic per-item/per-frame aliases derived from @trade-automation/contracts'
 * response/union schemas. These are type-level projections (`[number]`,
 * `Extract<...>`), not hand-kept duplicates of the wire shapes — the shapes
 * themselves live only in the shared package.
 */
import type {
  HealthResponse,
  InstrumentsResponse,
  StrategiesResponse,
  WsClientMessage,
  WsServerMessage,
} from '@trade-automation/contracts';

export type InstrumentWithStatus = InstrumentsResponse[number];
export type StrategyInfo = StrategiesResponse[number];
export type Health = HealthResponse;

export type WsClientFrame = WsClientMessage;
export type WsServerFrame = WsServerMessage;
export type WsCandleFrame = Extract<WsServerMessage, { type: 'candle' }>;
export type WsSignalFrame = Extract<WsServerMessage, { type: 'signal' }>;
export type WsIndicatorFrame = Extract<WsServerMessage, { type: 'indicator' }>;
export type WsStatusFrame = Extract<WsServerMessage, { type: 'status' }>;
export type WsPongFrame = Extract<WsServerMessage, { type: 'pong' }>;
