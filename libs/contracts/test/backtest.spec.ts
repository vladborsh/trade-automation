import {
  AdvanceRequestSchema,
  AdvanceResultSchema,
  AheadQuerySchema,
  AheadResponseSchema,
  BacktestInstrumentSchema,
  CancelRequestSchema,
  CloseRequestSchema,
  CostsSchema,
  CreateSessionRequestSchema,
  ErrorResponseSchema,
  FillEventSchema,
  ModifyOrderRequestSchema,
  Order,
  OrderModificationSchema,
  OrderSchema,
  PatchSessionRequestSchema,
  PlaceOrderRequestSchema,
  ReplayHistoryQuerySchema,
  ReplayHistoryResponseSchema,
  ScreenshotKindSchema,
  Session,
  SessionDetailSchema,
  SessionLayoutSchema,
  SessionSchema,
  SessionStats,
  SessionStatsSchema,
  SessionSummary,
  SessionSummarySchema,
} from '../src';

function validOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    sessionId: '22222222-2222-2222-2222-222222222222',
    seq: 1,
    panelId: 'btc',
    instrument: 'binance:BTCUSDT',
    side: 'long',
    type: 'market',
    status: 'open',
    placedAtMs: 1_726_000_000_000,
    limitPrice: null,
    entryPrice: 60_000,
    entryTimeMs: 1_726_000_060_000,
    qty: 0.01,
    riskPct: 1,
    riskAmountCcy: 100,
    slInitial: 59_000,
    slCurrent: 59_000,
    tpInitial: 62_000,
    tpCurrent: 62_000,
    exitPrice: null,
    exitTimeMs: null,
    closeReason: null,
    fillResolution: '1m',
    slTpSameBar: false,
    commissionCcy: 0.5,
    spreadCostCcy: 0.1,
    pnlCcy: null,
    pnlR: null,
    maePrice: null,
    maeR: null,
    cancelledAtMs: null,
    createdAt: 1_726_000_000_000,
    updatedAt: 1_726_000_060_000,
    ...overrides,
  };
}

function validStats(): SessionStats {
  return {
    trades: 2,
    wins: 1,
    losses: 1,
    breakeven: 0,
    winRate: 0.5,
    pnl: 40,
    pnlR: 0.4,
    grossProfit: 100,
    grossProfitR: 1,
    grossLoss: -60,
    grossLossR: -0.6,
    profitFactor: 1.6667,
    equityCurve: [{ time: 1_726_000_000_000, balance: 10_000, balanceR: 0 }],
    maxDrawdownCcy: 60,
    maxDrawdownR: 0.6,
    maxDrawdownPct: 0.6,
    avgWin: 100,
    avgWinR: 1,
    avgLoss: -60,
    avgLossR: -0.6,
    expectancyR: 0.2,
    maeAvg: 0.3,
    maeWorst: 0.9,
    pessimisticTrades: 0,
    endOfSessionCloses: 0,
    byInstrument: { 'binance:BTCUSDT': { trades: 2, pnl: 40, pnlR: 0.4, winRate: 0.5 } },
    bySide: { long: { trades: 2, pnl: 40, pnlR: 0.4, winRate: 0.5 } },
  };
}

function validSession(overrides: Partial<Session> = {}): Session {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Crypto Sept',
    status: 'active',
    sessionCurrency: 'USD',
    timeframe: '5m',
    periodFromMs: 1_700_000_000_000,
    periodToMs: 1_710_000_000_000,
    cursorMs: 1_700_000_300_000,
    initialBalance: 10_000,
    balance: 10_040,
    defaultRiskPct: 1,
    costs: { enabled: true, commissionPct: 0.04, spread: 1 },
    skipWeekends: true,
    notionalWarnMultiple: 5,
    layout: {
      id: 'session-1',
      name: 'BTC',
      grid: { columns: 1, rows: 1 },
      panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }],
    },
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_300_000,
    completedAt: null,
    ...overrides,
  };
}

function validSummary(): SessionSummary {
  return {
    ...validSession(),
    tradesCount: 2,
    winsCount: 1,
    lossesCount: 1,
    pnlCcy: 40,
    pnlR: 0.4,
    profitFactor: 1.6667,
    maxDrawdownCcy: 60,
    maxDrawdownR: 0.6,
    avgWinCcy: 100,
    avgWinR: 1,
    avgLossCcy: -60,
    avgLossR: -0.6,
    statsComputedAt: 1_700_000_300_000,
  };
}

describe('backtest contracts (architecture/backtest-app-system-design.md)', () => {
  it('parses a valid candle-only SessionLayout (D10)', () => {
    const layout = {
      id: 'session-1',
      name: 'BTC + ETH',
      grid: { columns: 2, rows: 1 },
      panels: [
        { id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false },
        { id: 'eth', kind: 'candles', instrument: 'binance:ETHUSDT', signals: false },
      ],
    };
    expect(SessionLayoutSchema.parse(layout)).toEqual(layout);
  });

  it('rejects a SessionLayout with more than 4 panels', () => {
    const panel = (id: string) => ({ id, kind: 'candles' as const, instrument: 'binance:BTCUSDT' as const, signals: false });
    expect(() =>
      SessionLayoutSchema.parse({
        id: 'too-many',
        name: 'Too many',
        grid: { columns: 4, rows: 4 },
        panels: [panel('a'), panel('b'), panel('c'), panel('d'), panel('e')],
      }),
    ).toThrow();
  });

  it('parses a valid CreateSessionRequest', () => {
    const req = {
      name: 'Crypto Sept',
      layout: {
        id: 'session-1',
        name: 'BTC',
        grid: { columns: 1, rows: 1 },
        panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }],
      },
      timeframe: '5m' as const,
      periodFromMs: 1_700_000_000_000,
      periodToMs: 1_710_000_000_000,
      initialBalance: 10_000,
      defaultRiskPct: 1,
      costs: { enabled: true, commissionPct: 0.04, spread: 1 },
    };
    expect(CreateSessionRequestSchema.parse(req).name).toBe('Crypto Sept');
  });

  it('rejects a CreateSessionRequest with a non-positive initialBalance', () => {
    expect(() =>
      CreateSessionRequestSchema.parse({
        name: 'Bad',
        layout: {
          id: 'session-1',
          name: 'BTC',
          grid: { columns: 1, rows: 1 },
          panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }],
        },
        timeframe: '5m',
        periodFromMs: 1_700_000_000_000,
        periodToMs: 1_710_000_000_000,
        initialBalance: 0,
        defaultRiskPct: 1,
        costs: { enabled: true, commissionPct: 0.04, spread: 1 },
      }),
    ).toThrow();
  });

  it('parses a valid PatchSessionRequest with only timeframe', () => {
    expect(PatchSessionRequestSchema.parse({ timeframe: '1h' })).toEqual({ timeframe: '1h' });
  });

  it('rejects a PatchSessionRequest with an unknown timeframe', () => {
    expect(() => PatchSessionRequestSchema.parse({ timeframe: '3m' })).toThrow();
  });

  it('parses a valid Costs', () => {
    const costs = { enabled: true, commissionPct: 0.04, spread: 0.5 };
    expect(CostsSchema.parse(costs)).toEqual(costs);
  });

  it('rejects Costs with a negative spread', () => {
    expect(() => CostsSchema.parse({ enabled: true, commissionPct: 0.04, spread: -1 })).toThrow();
  });

  it('parses a valid Session', () => {
    const session = validSession();
    expect(SessionSchema.parse(session)).toEqual(session);
  });

  it('rejects a Session with an invalid status', () => {
    expect(() => SessionSchema.parse(validSession({ status: 'paused' as never }))).toThrow();
  });

  it('parses a valid SessionSummary', () => {
    const summary = validSummary();
    expect(SessionSummarySchema.parse(summary)).toEqual(summary);
  });

  it('rejects a SessionSummary missing tradesCount', () => {
    const { tradesCount, ...rest } = validSummary();
    expect(() => SessionSummarySchema.parse(rest)).toThrow();
  });

  it('parses a valid SessionDetail', () => {
    const detail = { session: validSession(), openOrders: [validOrder({ status: 'pending' })], stats: validStats() };
    expect(SessionDetailSchema.parse(detail).openOrders).toHaveLength(1);
  });

  it('rejects a SessionDetail with a non-array openOrders', () => {
    expect(() =>
      SessionDetailSchema.parse({ session: validSession(), openOrders: {}, stats: validStats() }),
    ).toThrow();
  });

  it('parses a valid closed Order', () => {
    const order = validOrder();
    expect(OrderSchema.parse(order)).toEqual(order);
  });

  it('rejects an Order with an unknown side', () => {
    expect(() => OrderSchema.parse(validOrder({ side: 'flat' as never }))).toThrow();
  });

  it('parses a valid OrderModification', () => {
    const mod = {
      id: 1,
      orderId: '11111111-1111-1111-1111-111111111111',
      cursorMs: 1_700_000_100_000,
      field: 'sl' as const,
      oldValue: 59_000,
      newValue: 59_500,
      createdAt: 1_700_000_100_000,
    };
    expect(OrderModificationSchema.parse(mod)).toEqual(mod);
  });

  it('rejects an OrderModification with an unknown field', () => {
    expect(() =>
      OrderModificationSchema.parse({
        id: 1,
        orderId: '11111111-1111-1111-1111-111111111111',
        cursorMs: 1_700_000_100_000,
        field: 'entry',
        oldValue: 59_000,
        newValue: 59_500,
        createdAt: 1_700_000_100_000,
      }),
    ).toThrow();
  });

  it('parses a valid FillEvent', () => {
    const event = {
      orderId: '11111111-1111-1111-1111-111111111111',
      kind: 'fill' as const,
      time: 1_700_000_060_000,
      price: 60_000,
      resolution: '1m' as const,
    };
    expect(FillEventSchema.parse(event)).toEqual(event);
  });

  it('rejects a FillEvent with an unknown resolution', () => {
    expect(() =>
      FillEventSchema.parse({
        orderId: '11111111-1111-1111-1111-111111111111',
        kind: 'fill',
        time: 1_700_000_060_000,
        price: 60_000,
        resolution: 'tick',
      }),
    ).toThrow();
  });

  it('parses a valid market PlaceOrderRequest', () => {
    const req = {
      opId: '33333333-3333-3333-3333-333333333333',
      cursorMs: 1_700_000_000_000,
      panelId: 'btc',
      side: 'long' as const,
      type: 'market' as const,
      sl: 59_000,
      riskPct: 1,
    };
    expect(PlaceOrderRequestSchema.parse(req)).toEqual(req);
  });

  it('rejects a limit PlaceOrderRequest missing limitPrice', () => {
    expect(() =>
      PlaceOrderRequestSchema.parse({
        opId: '33333333-3333-3333-3333-333333333333',
        cursorMs: 1_700_000_000_000,
        panelId: 'btc',
        side: 'long',
        type: 'limit',
        sl: 59_000,
        riskPct: 1,
      }),
    ).toThrow();
  });

  it('parses a valid CancelRequest', () => {
    const req = { opId: '33333333-3333-3333-3333-333333333333', cursorMs: 1_700_000_000_000 };
    expect(CancelRequestSchema.parse(req)).toEqual(req);
  });

  it('rejects a CancelRequest with a negative cursorMs', () => {
    expect(() =>
      CancelRequestSchema.parse({ opId: '33333333-3333-3333-3333-333333333333', cursorMs: -1 }),
    ).toThrow();
  });

  it('parses a valid CloseRequest', () => {
    const req = { opId: '33333333-3333-3333-3333-333333333333', cursorMs: 1_700_000_000_000 };
    expect(CloseRequestSchema.parse(req)).toEqual(req);
  });

  it('rejects a CloseRequest missing opId', () => {
    expect(() => CloseRequestSchema.parse({ cursorMs: 1_700_000_000_000 })).toThrow();
  });

  it('parses a valid ModifyOrderRequest', () => {
    const req = { opId: '33333333-3333-3333-3333-333333333333', cursorMs: 1_700_000_000_000, sl: 59_200 };
    expect(ModifyOrderRequestSchema.parse(req)).toEqual(req);
  });

  it('rejects a ModifyOrderRequest with a non-numeric sl', () => {
    expect(() =>
      ModifyOrderRequestSchema.parse({
        opId: '33333333-3333-3333-3333-333333333333',
        cursorMs: 1_700_000_000_000,
        sl: '59200',
      }),
    ).toThrow();
  });

  it('parses a valid AdvanceRequest', () => {
    const req = { opId: '33333333-3333-3333-3333-333333333333', toCursorMs: 1_700_000_300_000 };
    expect(AdvanceRequestSchema.parse(req)).toEqual(req);
  });

  it('rejects an AdvanceRequest with a non-integer toCursorMs', () => {
    expect(() =>
      AdvanceRequestSchema.parse({ opId: '33333333-3333-3333-3333-333333333333', toCursorMs: 1.5 }),
    ).toThrow();
  });

  it('parses a valid AdvanceResult', () => {
    const result = {
      cursorMs: 1_700_000_300_000,
      status: 'active' as const,
      balance: 10_040,
      events: [],
      orders: [validOrder()],
      stats: validStats(),
    };
    expect(AdvanceResultSchema.parse(result).orders).toHaveLength(1);
  });

  it('rejects an AdvanceResult with an unknown status', () => {
    expect(() =>
      AdvanceResultSchema.parse({
        cursorMs: 1_700_000_300_000,
        status: 'paused',
        balance: 10_040,
        events: [],
        orders: [],
        stats: validStats(),
      }),
    ).toThrow();
  });

  it('parses a valid SessionStats', () => {
    const stats = validStats();
    expect(SessionStatsSchema.parse(stats)).toEqual(stats);
  });

  it('rejects SessionStats with a negative trades count', () => {
    expect(() => SessionStatsSchema.parse({ ...validStats(), trades: -1 })).toThrow();
  });

  it('requires the R counterparts of the money figures (§8: currency and R)', () => {
    for (const field of ['pnlR', 'grossProfitR', 'grossLossR', 'avgWinR', 'avgLossR'] as const) {
      const { [field]: _dropped, ...rest } = validStats();
      expect(() => SessionStatsSchema.parse(rest)).toThrow();
    }
    const stats = validStats();
    const { pnlR: _pnlR, ...breakdown } = stats.bySide.long!;
    expect(() => SessionStatsSchema.parse({ ...stats, bySide: { long: breakdown } })).toThrow();
  });

  it('accepts null avgWinR / avgLossR, like avgWin / avgLoss', () => {
    const stats = { ...validStats(), avgWin: null, avgWinR: null, avgLoss: null, avgLossR: null };
    expect(SessionStatsSchema.parse(stats)).toEqual(stats);
  });

  it('coerces a valid ReplayHistoryQuery from query-string values', () => {
    const parsed = ReplayHistoryQuerySchema.parse({
      panelId: 'btc',
      timeframe: '5m',
      before: '1700000300000',
      limit: '500',
    });
    expect(parsed).toEqual({ panelId: 'btc', timeframe: '5m', before: 1_700_000_300_000, limit: 500 });
  });

  it('rejects a ReplayHistoryQuery with limit over 1500', () => {
    expect(() =>
      ReplayHistoryQuerySchema.parse({ panelId: 'btc', timeframe: '5m', before: '1700000300000', limit: '2000' }),
    ).toThrow();
  });

  it('parses a valid ReplayHistoryResponse with no forming bar', () => {
    const response = { bars: [], forming: null };
    expect(ReplayHistoryResponseSchema.parse(response)).toEqual(response);
  });

  it('rejects a ReplayHistoryResponse with a malformed bar', () => {
    expect(() => ReplayHistoryResponseSchema.parse({ bars: [{ instrument: 'binance:BTCUSDT' }], forming: null })).toThrow();
  });

  it('coerces a valid AheadQuery from query-string values', () => {
    const parsed = AheadQuerySchema.parse({ panelId: 'btc', fromMs: '1700000300000', limit: '1000' });
    expect(parsed).toEqual({ panelId: 'btc', fromMs: 1_700_000_300_000, limit: 1000 });
  });

  it('rejects an AheadQuery with limit over 5000', () => {
    expect(() => AheadQuerySchema.parse({ panelId: 'btc', fromMs: '1700000300000', limit: '5001' })).toThrow();
  });

  it('parses a valid AheadResponse of compact tuples', () => {
    const response = { candles: [[1_700_000_300_000, 60_000, 60_100, 59_900, 60_050, 12.5]], endOfTape: false };
    expect(AheadResponseSchema.parse(response)).toEqual(response);
  });

  it('rejects an AheadResponse tuple with a missing field', () => {
    expect(() =>
      AheadResponseSchema.parse({ candles: [[1_700_000_300_000, 60_000, 60_100, 59_900, 60_050]], endOfTape: false }),
    ).toThrow();
  });

  it('parses both ScreenshotKind values', () => {
    expect(ScreenshotKindSchema.parse('entry')).toBe('entry');
    expect(ScreenshotKindSchema.parse('exit')).toBe('exit');
  });

  it('rejects an unknown ScreenshotKind', () => {
    expect(() => ScreenshotKindSchema.parse('preview')).toThrow();
  });

  it('parses a valid BacktestInstrument with coverage', () => {
    const instrument = {
      id: 'binance:BTCUSDT' as const,
      displayName: 'BTC/USDT Perp',
      assetClass: 'crypto-perp' as const,
      sessionCurrency: 'USD',
      pricePrecision: 2,
      coverage: { from: 1_600_000_000_000, to: 1_726_000_000_000 },
    };
    expect(BacktestInstrumentSchema.parse(instrument)).toEqual(instrument);
  });

  it('parses a valid BacktestInstrument with null coverage', () => {
    const instrument = {
      id: 'binance:BTCUSDT' as const,
      displayName: 'BTC/USDT Perp',
      assetClass: 'crypto-perp' as const,
      sessionCurrency: 'USD',
      pricePrecision: 2,
      coverage: null,
    };
    expect(BacktestInstrumentSchema.parse(instrument)).toEqual(instrument);
  });

  it('rejects a BacktestInstrument missing coverage', () => {
    expect(() =>
      BacktestInstrumentSchema.parse({
        id: 'binance:BTCUSDT',
        displayName: 'BTC/USDT Perp',
        assetClass: 'crypto-perp',
        sessionCurrency: 'USD',
        pricePrecision: 2,
      }),
    ).toThrow();
  });

  it('parses a valid error envelope', () => {
    const err = { error: { code: 'CURSOR_BACKWARDS' as const, message: 'cursor cannot move backwards' } };
    expect(ErrorResponseSchema.parse(err)).toEqual(err);
  });

  it('rejects an error envelope with an unknown code', () => {
    expect(() => ErrorResponseSchema.parse({ error: { code: 'NOT_A_REAL_CODE', message: 'x' } })).toThrow();
  });
});
