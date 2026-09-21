import { z } from 'zod';
import { CandleSchema } from './candle';
import { AssetClassSchema, InstrumentIdSchema } from './instrument';
import { LayoutGridSchema } from './layout';
import { TimeframeSchema } from './timeframe';

/**
 * architecture/backtest-app-system-design.md — wire contracts for the manual backtest app
 * (§3 data model, §6 fill engine, §7 API surface, §8 statistics). Additive to `contracts`;
 * `LayoutSchema` (the live terminal's 6-panel/metric layout) is untouched (§14) — session
 * layouts here are a separate, stricter shape.
 */

// ---------------------------------------------------------------------------------------------
// Session layout (§14: candle panels only, 1..4, `signals` accepted but ignored in replay — D10)
// ---------------------------------------------------------------------------------------------

export const SessionPanelSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.literal('candles'),
  instrument: InstrumentIdSchema,
  /** Accepted for compatibility with `layouts.yaml` presets; has no meaning in replay (D10). */
  signals: z.boolean().default(false),
  title: z.string().min(1).optional(),
});
export type SessionPanel = z.infer<typeof SessionPanelSchema>;

export const SessionLayoutSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    grid: LayoutGridSchema,
    panels: z.array(SessionPanelSchema).min(1).max(4),
  })
  .superRefine((l, ctx) => {
    if (l.panels.length > l.grid.columns * l.grid.rows) {
      ctx.addIssue({ code: 'custom', message: 'more panels than grid cells' });
    }
    if (new Set(l.panels.map((p) => p.id)).size !== l.panels.length) {
      ctx.addIssue({ code: 'custom', message: 'duplicate panel id' });
    }
  });
export type SessionLayout = z.infer<typeof SessionLayoutSchema>;

// ---------------------------------------------------------------------------------------------
// Numeric bounds (BUG-002/BUG-003 — provisional, pending Architect confirmation)
// ---------------------------------------------------------------------------------------------

/**
 * What the Postgres columns can hold (§3), with product-sane caps where a column allows absurd
 * values. Request fields are bounded here so an out-of-range body is a 400 from the schema, never
 * a pg 22003 overflow (500) or a silent round-to-zero. Money and prices are `numeric(20,8)` (max
 * < 1e12); percentages `numeric(8,4)` (resolution 0.0001); `notional_warn_multiple` is
 * `numeric(8,2)`. The client's form validation reuses these numbers.
 */
export const BACKTEST_BOUNDS = {
  /** exclusive upper bound of every numeric(20,8) money/price field */
  moneyMaxExclusive: 1e12,
  /** riskPct / defaultRiskPct: percent of balance, from the numeric(8,4) resolution up to 100 */
  riskPctMin: 0.0001,
  riskPctMax: 100,
  commissionPctMax: 100,
  notionalWarnMultipleMax: 999_999.99,
} as const;

const RiskPctSchema = z.number().min(BACKTEST_BOUNDS.riskPctMin).max(BACKTEST_BOUNDS.riskPctMax);
/** An order level (limit, stop, target): a positive price that fits numeric(20,8). */
const PriceLevelSchema = z.number().positive().lt(BACKTEST_BOUNDS.moneyMaxExclusive);

// ---------------------------------------------------------------------------------------------
// Costs, sessions
// ---------------------------------------------------------------------------------------------

export const CostsSchema = z.object({
  enabled: z.boolean(),
  commissionPct: z.number().nonnegative().max(BACKTEST_BOUNDS.commissionPctMax),
  spread: z.number().nonnegative().lt(BACKTEST_BOUNDS.moneyMaxExclusive),
});
export type Costs = z.infer<typeof CostsSchema>;

export const SessionStatusSchema = z.enum(['active', 'complete']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/** §7.2 POST /backtest/sessions. */
export const CreateSessionRequestSchema = z.object({
  name: z.string().min(1),
  layout: SessionLayoutSchema,
  timeframe: TimeframeSchema,
  periodFromMs: z.number().int().nonnegative(),
  periodToMs: z.number().int().nonnegative(),
  initialBalance: z.number().positive().lt(BACKTEST_BOUNDS.moneyMaxExclusive),
  defaultRiskPct: RiskPctSchema,
  costs: CostsSchema,
  skipWeekends: z.boolean().optional(),
  notionalWarnMultiple: z.number().positive().max(BACKTEST_BOUNDS.notionalWarnMultipleMax).optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

/** §7.2 PATCH /backtest/sessions/:id. */
export const PatchSessionRequestSchema = z.object({
  name: z.string().min(1).optional(),
  timeframe: TimeframeSchema.optional(),
  layout: SessionLayoutSchema.optional(),
});
export type PatchSessionRequest = z.infer<typeof PatchSessionRequestSchema>;

const SessionCoreSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  status: SessionStatusSchema,
  sessionCurrency: z.string().min(1),
  timeframe: TimeframeSchema,
  periodFromMs: z.number().int().nonnegative(),
  periodToMs: z.number().int().nonnegative(),
  cursorMs: z.number().int().nonnegative(),
  initialBalance: z.number(),
  balance: z.number(),
  defaultRiskPct: z.number().positive(),
  costs: CostsSchema,
  skipWeekends: z.boolean(),
  notionalWarnMultiple: z.number().positive(),
  layout: SessionLayoutSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
});

export const SessionSchema = SessionCoreSchema;
export type Session = z.infer<typeof SessionSchema>;

/** §3 `backtest_sessions` stored aggregates (decision 38), camelCase. */
export const SessionAggregatesSchema = z.object({
  tradesCount: z.number().int().nonnegative(),
  winsCount: z.number().int().nonnegative(),
  lossesCount: z.number().int().nonnegative(),
  pnlCcy: z.number(),
  pnlR: z.number(),
  profitFactor: z.number().nullable(),
  maxDrawdownCcy: z.number().nonnegative(),
  maxDrawdownR: z.number().nonnegative(),
  avgWinCcy: z.number().nullable(),
  avgWinR: z.number().nullable(),
  avgLossCcy: z.number().nullable(),
  avgLossR: z.number().nullable(),
  statsComputedAt: z.number().int().nonnegative().nullable(),
});
export type SessionAggregates = z.infer<typeof SessionAggregatesSchema>;

/** §7.2 GET /backtest/sessions — config + aggregates, no orders (decision 38). */
export const SessionSummarySchema = SessionCoreSchema.extend(SessionAggregatesSchema.shape);
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionSummariesResponseSchema = z.array(SessionSummarySchema);
export type SessionSummariesResponse = z.infer<typeof SessionSummariesResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Orders (§3 `orders` table, every column in camelCase)
// ---------------------------------------------------------------------------------------------

export const OrderSideSchema = z.enum(['long', 'short']);
export type OrderSide = z.infer<typeof OrderSideSchema>;

export const OrderTypeSchema = z.enum(['market', 'limit']);
export type OrderType = z.infer<typeof OrderTypeSchema>;

export const OrderStatusSchema = z.enum(['pending', 'open', 'closed', 'cancelled']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const CloseReasonSchema = z.enum(['stop', 'take-profit', 'manual', 'end-of-session']);
export type CloseReason = z.infer<typeof CloseReasonSchema>;

/** decision 4 — which path resolved the fill/exit. */
export const FillResolutionSchema = z.enum(['1m', 'pessimistic-bar']);
export type FillResolution = z.infer<typeof FillResolutionSchema>;

export const OrderSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  seq: z.number().int().positive(),
  panelId: z.string().min(1),
  instrument: InstrumentIdSchema,
  side: OrderSideSchema,
  type: OrderTypeSchema,
  status: OrderStatusSchema,
  placedAtMs: z.number().int().nonnegative(),
  limitPrice: z.number().nullable(),
  entryPrice: z.number().nullable(),
  entryTimeMs: z.number().int().nonnegative().nullable(),
  qty: z.number().nonnegative(),
  riskPct: z.number().positive(),
  riskAmountCcy: z.number().nonnegative(),
  slInitial: z.number(),
  slCurrent: z.number(),
  tpInitial: z.number().nullable(),
  tpCurrent: z.number().nullable(),
  exitPrice: z.number().nullable(),
  exitTimeMs: z.number().int().nonnegative().nullable(),
  closeReason: CloseReasonSchema.nullable(),
  fillResolution: FillResolutionSchema.nullable(),
  slTpSameBar: z.boolean(),
  commissionCcy: z.number().nonnegative(),
  spreadCostCcy: z.number().nonnegative(),
  pnlCcy: z.number().nullable(),
  pnlR: z.number().nullable(),
  maePrice: z.number().nullable(),
  maeR: z.number().nullable(),
  cancelledAtMs: z.number().int().nonnegative().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type Order = z.infer<typeof OrderSchema>;

/** §3 `order_modifications` — decision 23. */
export const OrderModificationSchema = z.object({
  id: z.number().int().positive(),
  orderId: z.string().uuid(),
  cursorMs: z.number().int().nonnegative(),
  field: z.enum(['sl', 'tp']),
  oldValue: z.number().nullable(),
  newValue: z.number().nullable(),
  createdAt: z.number().int().nonnegative(),
});
export type OrderModification = z.infer<typeof OrderModificationSchema>;

/** §6 — `evaluateOrder(order, path, costs) => FillEvent[]`, the single fill entry point. */
export const FillEventSchema = z.object({
  orderId: z.string().uuid(),
  kind: z.enum(['fill', 'exit']),
  time: z.number().int().nonnegative(),
  price: z.number(),
  reason: CloseReasonSchema.optional(),
  resolution: FillResolutionSchema,
});
export type FillEvent = z.infer<typeof FillEventSchema>;

/** §7.2 GET /backtest/sessions/:id/orders/:orderId — order + modifications + screenshot links. */
export const OrderDetailSchema = z.object({
  order: OrderSchema,
  modifications: z.array(OrderModificationSchema),
  screenshots: z.object({
    entry: z.string().min(1).optional(),
    exit: z.string().min(1).optional(),
  }),
});
export type OrderDetail = z.infer<typeof OrderDetailSchema>;

// ---------------------------------------------------------------------------------------------
// Mutating requests — every one carries `opId` (D9) and, other than `advance`, `cursorMs`
// ---------------------------------------------------------------------------------------------

/** §7.2 POST /backtest/sessions/:id/orders. Stop entries are not in v1 (§13, decision 29). */
export const PlaceOrderRequestSchema = z
  .object({
    opId: z.string().uuid(),
    cursorMs: z.number().int().nonnegative(),
    panelId: z.string().min(1),
    side: OrderSideSchema,
    type: OrderTypeSchema,
    limitPrice: PriceLevelSchema.optional(),
    sl: PriceLevelSchema,
    tp: PriceLevelSchema.optional(),
    riskPct: RiskPctSchema,
  })
  .superRefine((req, ctx) => {
    if (req.type === 'limit' && req.limitPrice === undefined) {
      ctx.addIssue({ code: 'custom', message: 'limit orders require limitPrice', path: ['limitPrice'] });
    }
  });
export type PlaceOrderRequest = z.infer<typeof PlaceOrderRequestSchema>;

export const PlaceOrderResponseSchema = z.object({
  order: OrderSchema,
  events: z.array(FillEventSchema),
});
export type PlaceOrderResponse = z.infer<typeof PlaceOrderResponseSchema>;

/** §7.2 POST .../cancel and .../close share this shape. */
export const CancelRequestSchema = z.object({
  opId: z.string().uuid(),
  cursorMs: z.number().int().nonnegative(),
});
export type CancelRequest = z.infer<typeof CancelRequestSchema>;

export const CloseRequestSchema = z.object({
  opId: z.string().uuid(),
  cursorMs: z.number().int().nonnegative(),
});
export type CloseRequest = z.infer<typeof CloseRequestSchema>;

export const CloseResponseSchema = z.object({
  order: OrderSchema,
  stats: z.lazy(() => SessionStatsSchema),
  balance: z.number(),
});
export type CloseResponse = z.infer<typeof CloseResponseSchema>;

/** §7.2 PATCH /backtest/sessions/:id/orders/:orderId — decision 23, P2 stop/target move. */
export const ModifyOrderRequestSchema = z.object({
  opId: z.string().uuid(),
  cursorMs: z.number().int().nonnegative(),
  sl: PriceLevelSchema.optional(),
  tp: PriceLevelSchema.optional(),
});
export type ModifyOrderRequest = z.infer<typeof ModifyOrderRequestSchema>;

/** §5.5, §7.2 POST /backtest/sessions/:id/advance — D4/D9. */
export const AdvanceRequestSchema = z.object({
  opId: z.string().uuid(),
  toCursorMs: z.number().int().nonnegative(),
});
export type AdvanceRequest = z.infer<typeof AdvanceRequestSchema>;

export const AdvanceResultSchema = z.object({
  cursorMs: z.number().int().nonnegative(),
  status: SessionStatusSchema,
  balance: z.number(),
  events: z.array(FillEventSchema),
  orders: z.array(OrderSchema),
  stats: z.lazy(() => SessionStatsSchema),
});
export type AdvanceResult = z.infer<typeof AdvanceResultSchema>;

// ---------------------------------------------------------------------------------------------
// Statistics (§8)
// ---------------------------------------------------------------------------------------------

export const EquityPointSchema = z.object({
  time: z.number().int().nonnegative(),
  balance: z.number(),
  balanceR: z.number(),
});
export type EquityPoint = z.infer<typeof EquityPointSchema>;

export const StatsBreakdownSchema = z.object({
  trades: z.number().int().nonnegative(),
  pnl: z.number(),
  pnlR: z.number(),
  winRate: z.number(),
});
export type StatsBreakdown = z.infer<typeof StatsBreakdownSchema>;

/**
 * §8 `computeStats(closedTrades) => SessionStats`. Every money figure in both currency and R
 * (§8, decision 21): the unsuffixed / `Ccy` fields are currency, the `R` fields R multiples.
 */
export const SessionStatsSchema = z.object({
  trades: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  breakeven: z.number().int().nonnegative(),
  winRate: z.number(),
  pnl: z.number(),
  pnlR: z.number(),
  grossProfit: z.number(),
  grossProfitR: z.number(),
  grossLoss: z.number(),
  grossLossR: z.number(),
  profitFactor: z.number().nullable(),
  equityCurve: z.array(EquityPointSchema),
  maxDrawdownCcy: z.number().nonnegative(),
  maxDrawdownR: z.number().nonnegative(),
  maxDrawdownPct: z.number().nonnegative(),
  avgWin: z.number().nullable(),
  avgWinR: z.number().nullable(),
  avgLoss: z.number().nullable(),
  avgLossR: z.number().nullable(),
  expectancyR: z.number(),
  maeAvg: z.number().nullable(),
  maeWorst: z.number().nullable(),
  pessimisticTrades: z.number().int().nonnegative(),
  endOfSessionCloses: z.number().int().nonnegative(),
  byInstrument: z.record(InstrumentIdSchema, StatsBreakdownSchema),
  bySide: z.record(OrderSideSchema, StatsBreakdownSchema),
});
export type SessionStats = z.infer<typeof SessionStatsSchema>;

/**
 * §7.2 GET /backtest/sessions/:id/stats — the recompute-vs-stored drift check (decision 38).
 * `stored` is the aggregate subset the session row actually holds (T-018 ruling, provisional
 * pending Architect confirmation): a full `SessionStats` cannot be rebuilt from those columns.
 */
export const SessionStatsResponseSchema = z.object({
  computed: SessionStatsSchema,
  stored: SessionAggregatesSchema,
  drift: z.boolean(),
});
export type SessionStatsResponse = z.infer<typeof SessionStatsResponseSchema>;

/** §7.2 GET /backtest/sessions/:id — session + open orders + stats. */
export const SessionDetailSchema = z.object({
  session: SessionSchema,
  openOrders: z.array(OrderSchema),
  stats: SessionStatsSchema,
});
export type SessionDetail = z.infer<typeof SessionDetailSchema>;

// ---------------------------------------------------------------------------------------------
// Replay history / ahead (§5.3, §7.2)
// ---------------------------------------------------------------------------------------------

/** §7.2 GET /backtest/sessions/:id/candles. `before` must be `<= cursorMs` (422 FUTURE_REQUESTED). */
export const ReplayHistoryQuerySchema = z.object({
  panelId: z.string().min(1),
  timeframe: TimeframeSchema,
  before: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().min(1).max(1500).default(1500),
});
export type ReplayHistoryQuery = z.infer<typeof ReplayHistoryQuerySchema>;

export const ReplayHistoryResponseSchema = z.object({
  bars: z.array(CandleSchema),
  forming: CandleSchema.nullable(),
});
export type ReplayHistoryResponse = z.infer<typeof ReplayHistoryResponseSchema>;

/** §5.3 — compact `[openTime, o, h, l, c, v]` tuples for the client's 1m ahead cache. */
export const CompactCandleTupleSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number().nonnegative(),
]);
export type CompactCandleTuple = z.infer<typeof CompactCandleTupleSchema>;

/** §7.2 GET /backtest/sessions/:id/candles/ahead. */
export const AheadQuerySchema = z.object({
  panelId: z.string().min(1),
  fromMs: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().min(1).max(5000).default(5000),
});
export type AheadQuery = z.infer<typeof AheadQuerySchema>;

export const AheadResponseSchema = z.object({
  candles: z.array(CompactCandleTupleSchema),
  endOfTape: z.boolean(),
});
export type AheadResponse = z.infer<typeof AheadResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Screenshots (§9.2)
// ---------------------------------------------------------------------------------------------

export const ScreenshotKindSchema = z.enum(['entry', 'exit']);
export type ScreenshotKind = z.infer<typeof ScreenshotKindSchema>;

export const ScreenshotUploadResponseSchema = z.object({
  key: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
});
export type ScreenshotUploadResponse = z.infer<typeof ScreenshotUploadResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Instruments (§7.2 GET /backtest/instruments — decisions 5b, 16)
// ---------------------------------------------------------------------------------------------

export const CoverageSchema = z.object({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
});
export type Coverage = z.infer<typeof CoverageSchema>;

export const BacktestInstrumentSchema = z.object({
  id: InstrumentIdSchema,
  displayName: z.string().min(1),
  assetClass: AssetClassSchema,
  sessionCurrency: z.string().min(1),
  pricePrecision: z.number().int().min(0),
  coverage: CoverageSchema.nullable(),
});
export type BacktestInstrument = z.infer<typeof BacktestInstrumentSchema>;

export const BacktestInstrumentsResponseSchema = z.array(BacktestInstrumentSchema);
export type BacktestInstrumentsResponse = z.infer<typeof BacktestInstrumentsResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Error envelope (§7 — every error code named across the auth/admin/backtest surface)
// ---------------------------------------------------------------------------------------------

export const BacktestErrorCodeSchema = z.enum([
  // §7.1 auth/admin
  'INVALID_CREDENTIALS',
  'USER_DISABLED',
  'INVITE_UNKNOWN',
  'INVITE_USED',
  'INVITE_EXPIRED',
  'EMAIL_TAKEN',
  'TOO_MANY_ATTEMPTS',
  // §7.2 backtest
  'LAYOUT_TOO_MANY_PANELS',
  'LAYOUT_NOT_CANDLES',
  'MIXED_SESSION_CURRENCY',
  'INSTRUMENT_NOT_AVAILABLE',
  'PERIOD_OUTSIDE_COVERAGE',
  'SESSION_COMPLETE',
  'FUTURE_REQUESTED',
  'CURSOR_BACKWARDS',
  'CURSOR_MISMATCH',
  'SL_ON_WRONG_SIDE',
  'TP_ON_WRONG_SIDE',
  'LIMIT_ON_WRONG_SIDE',
  'STOP_DISTANCE_ZERO',
  'ORDER_NOT_PENDING',
  'SCREENSHOT_EXISTS',
  // T-015 (§7.2 orders), provisional pending Architect confirmation:
  'BALANCE_NOT_POSITIVE', // 422 — the session balance is <= 0, so an order cannot be sized
  'NO_PRICE_AT_CURSOR', // 422 — no revealed 1m candle within the lookback, so no lastClose
  'ORDER_NOT_OPEN', // 409 — close on an order that is not open (mirror of ORDER_NOT_PENDING)
]);
export type BacktestErrorCode = z.infer<typeof BacktestErrorCodeSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: BacktestErrorCodeSchema,
    message: z.string().min(1),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
