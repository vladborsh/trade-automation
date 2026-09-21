import { Costs, FillEvent, Order, OrderSide } from '@trade-automation/contracts';
import { TradeResult } from '../fill/trade-result';
import { EngineFillEvent, PathBar } from '../fill/types';
import {
  FIXTURE_COSTS_OFF as OFF,
  FIXTURE_COSTS_ON as ON,
  FIXTURE_LONG_ID,
  FIXTURE_SHORT_ID,
  fixtureBar as bar,
  fixtureTime as t,
} from './common';

/**
 * architecture/backtest-app-system-design.md §6 — reference fixtures for everything around the
 * fill table: market prices, sizing, trade results, MAE, floating mark and open risk. Same cost
 * vocabulary as the fill table (costs on: half-spread 1, commission 0.1 % per side). Every
 * expected number is worked in the comment next to it. Compare money with `toBeCloseTo` — the
 * values are float64 sums.
 */

// ---------------------------------------------------------------------------------------------
// §6 rows "Market entry at placement" and "Manual close / end of session"
// ---------------------------------------------------------------------------------------------

export interface MarketEntryFixture {
  name: string;
  side: OrderSide;
  costs: Costs;
  lastClose: number;
  /** `marketFillPrice(side, lastClose, costs)` */
  expected: number;
}

export const MARKET_ENTRY_FIXTURES: readonly MarketEntryFixture[] = [
  { name: 'Market entry at placement · long · costs on', side: 'long', costs: ON, lastClose: 1000, expected: 1001 },
  { name: 'Market entry at placement · long · costs off', side: 'long', costs: OFF, lastClose: 1000, expected: 1000 },
  { name: 'Market entry at placement · short · costs on', side: 'short', costs: ON, lastClose: 1000, expected: 999 },
  { name: 'Market entry at placement · short · costs off', side: 'short', costs: OFF, lastClose: 1000, expected: 1000 },
];

export interface MarketExitFixture {
  name: string;
  order: { id: string; side: OrderSide };
  lastBar: PathBar;
  reason: 'manual' | 'end-of-session';
  costs: Costs;
  /** `marketExitEvent(order, lastBar, reason, costs)` */
  expected: EngineFillEvent;
}

const LAST_BAR = bar(3, 1004, 1006, 1003, 1005); // lastClose 1005
const exitEv = (orderId: string, price: number, reason: 'manual' | 'end-of-session'): EngineFillEvent => ({
  orderId, kind: 'exit', time: t(3), price, reason, resolution: '1m',
});
const L = { id: FIXTURE_LONG_ID, side: 'long' as const };
const S = { id: FIXTURE_SHORT_ID, side: 'short' as const };

export const MARKET_EXIT_FIXTURES: readonly MarketExitFixture[] = [
  { name: 'Manual close · long · costs on', order: L, lastBar: LAST_BAR, reason: 'manual', costs: ON, expected: exitEv(L.id, 1004, 'manual') },
  { name: 'Manual close · long · costs off', order: L, lastBar: LAST_BAR, reason: 'manual', costs: OFF, expected: exitEv(L.id, 1005, 'manual') },
  { name: 'Manual close · short · costs on', order: S, lastBar: LAST_BAR, reason: 'manual', costs: ON, expected: exitEv(S.id, 1006, 'manual') },
  { name: 'Manual close · short · costs off', order: S, lastBar: LAST_BAR, reason: 'manual', costs: OFF, expected: exitEv(S.id, 1005, 'manual') },
  { name: 'End of session · long · costs on', order: L, lastBar: LAST_BAR, reason: 'end-of-session', costs: ON, expected: exitEv(L.id, 1004, 'end-of-session') },
  { name: 'End of session · short · costs off', order: S, lastBar: LAST_BAR, reason: 'end-of-session', costs: OFF, expected: exitEv(S.id, 1005, 'end-of-session') },
];

// ---------------------------------------------------------------------------------------------
// §6 "Sizing"
// ---------------------------------------------------------------------------------------------

export interface SizingFixture {
  name: string;
  balance: number;
  riskPct: number;
  plannedEntry: number;
  sl: number;
  expected: { qty: number; riskAmount: number };
}

export const SIZING_FIXTURES: readonly SizingFixture[] = [
  // riskAmount = 10000 * 1 / 100 = 100; qty = 100 / |1000 - 990| = 10
  { name: 'long market, 1 % of 10 000, stop 10 away', balance: 10_000, riskPct: 1, plannedEntry: 1000, sl: 990, expected: { qty: 10, riskAmount: 100 } },
  // qty = 100 / |995 - 990| = 20
  { name: 'long limit, 1 % of 10 000, stop 5 away', balance: 10_000, riskPct: 1, plannedEntry: 995, sl: 990, expected: { qty: 20, riskAmount: 100 } },
  // qty = 100 / |1000 - 1010| = 10
  { name: 'short market, 1 % of 10 000, stop 10 away', balance: 10_000, riskPct: 1, plannedEntry: 1000, sl: 1010, expected: { qty: 10, riskAmount: 100 } },
  // compounded balance: riskAmount = 12 345 * 0.5 / 100 = 61.725; qty = 61.725 / 150 = 0.4115
  { name: 'BTC-sized, 0.5 % of a compounded 12 345', balance: 12_345, riskPct: 0.5, plannedEntry: 30_000, sl: 29_850, expected: { qty: 0.4115, riskAmount: 61.725 } },
];

// ---------------------------------------------------------------------------------------------
// §6 "Costs" — computeTradeResult
// ---------------------------------------------------------------------------------------------

export interface TradeResultFixture {
  name: string;
  order: Pick<Order, 'id' | 'side' | 'type' | 'entryPrice' | 'qty' | 'riskAmountCcy'>;
  exitEvent: FillEvent;
  costs: Costs;
  expected: TradeResult;
}

const exit = (orderId: string, price: number, reason: FillEvent['reason']): FillEvent => ({
  orderId, kind: 'exit', time: t(5), price, reason, resolution: '1m',
});

export const TRADE_RESULT_FIXTURES: readonly TradeResultFixture[] = [
  {
    // entry 1000 + 1 = 1001, stop 990 - 1 = 989, qty 10: gross (989 - 1001) * 10 = -120;
    // commission 0.1 % of 10 010 + 0.1 % of 9 890 = 10.01 + 9.89 = 19.9; pnl -139.9; R -1.399;
    // spread paid on both sides: 1 * 10 * 2 = 20
    name: 'long · market entry, stop exit · costs on',
    order: { id: FIXTURE_LONG_ID, side: 'long', type: 'market', entryPrice: 1001, qty: 10, riskAmountCcy: 100 },
    exitEvent: exit(FIXTURE_LONG_ID, 989, 'stop'), costs: ON,
    expected: { commissionCcy: 19.9, spreadCostCcy: 20, pnlCcy: -139.9, pnlR: -1.399 },
  },
  {
    name: 'long · market entry, stop exit · costs off',
    order: { id: FIXTURE_LONG_ID, side: 'long', type: 'market', entryPrice: 1000, qty: 10, riskAmountCcy: 100 },
    exitEvent: exit(FIXTURE_LONG_ID, 990, 'stop'), costs: OFF,
    expected: { commissionCcy: 0, spreadCostCcy: 0, pnlCcy: -100, pnlR: -1 },
  },
  {
    // limit 995, tp 1020, qty 20: gross 25 * 20 = 500; commission 19.9 + 20.4 = 40.3;
    // pnl 459.7; R 4.597; no side paid the spread
    name: 'long · limit entry, take-profit · costs on',
    order: { id: FIXTURE_LONG_ID, side: 'long', type: 'limit', entryPrice: 995, qty: 20, riskAmountCcy: 100 },
    exitEvent: exit(FIXTURE_LONG_ID, 1020, 'take-profit'), costs: ON,
    expected: { commissionCcy: 40.3, spreadCostCcy: 0, pnlCcy: 459.7, pnlR: 4.597 },
  },
  {
    name: 'long · limit entry, take-profit · costs off',
    order: { id: FIXTURE_LONG_ID, side: 'long', type: 'limit', entryPrice: 995, qty: 20, riskAmountCcy: 100 },
    exitEvent: exit(FIXTURE_LONG_ID, 1020, 'take-profit'), costs: OFF,
    expected: { commissionCcy: 0, spreadCostCcy: 0, pnlCcy: 500, pnlR: 5 },
  },
  {
    // entry 1000 + 1 = 1001, end-of-session at 1005 - 1 = 1004, qty 10: gross 30;
    // commission 10.01 + 10.04 = 20.05; pnl 9.95; R 0.0995; spread 20
    name: 'long · market entry, end-of-session exit · costs on',
    order: { id: FIXTURE_LONG_ID, side: 'long', type: 'market', entryPrice: 1001, qty: 10, riskAmountCcy: 100 },
    exitEvent: exit(FIXTURE_LONG_ID, 1004, 'end-of-session'), costs: ON,
    expected: { commissionCcy: 20.05, spreadCostCcy: 20, pnlCcy: 9.95, pnlR: 0.0995 },
  },
  {
    // entry 1000 - 1 = 999, manual close at 990 + 1 = 991, qty 10: gross -(991 - 999) * 10 = 80;
    // commission 9.99 + 9.91 = 19.9; pnl 60.1; R 0.601; spread 20
    name: 'short · market entry, manual close · costs on',
    order: { id: FIXTURE_SHORT_ID, side: 'short', type: 'market', entryPrice: 999, qty: 10, riskAmountCcy: 100 },
    exitEvent: exit(FIXTURE_SHORT_ID, 991, 'manual'), costs: ON,
    expected: { commissionCcy: 19.9, spreadCostCcy: 20, pnlCcy: 60.1, pnlR: 0.601 },
  },
  {
    name: 'short · market entry, manual close · costs off',
    order: { id: FIXTURE_SHORT_ID, side: 'short', type: 'market', entryPrice: 1000, qty: 10, riskAmountCcy: 100 },
    exitEvent: exit(FIXTURE_SHORT_ID, 990, 'manual'), costs: OFF,
    expected: { commissionCcy: 0, spreadCostCcy: 0, pnlCcy: 100, pnlR: 1 },
  },
  {
    // limit 1005, stop 1010 + 1 = 1011, qty 20: gross -(1011 - 1005) * 20 = -120;
    // commission 20.1 + 20.22 = 40.32; pnl -160.32; R -1.6032; spread paid on exit only: 1 * 20 = 20
    name: 'short · limit entry, stop exit · costs on',
    order: { id: FIXTURE_SHORT_ID, side: 'short', type: 'limit', entryPrice: 1005, qty: 20, riskAmountCcy: 100 },
    exitEvent: exit(FIXTURE_SHORT_ID, 1011, 'stop'), costs: ON,
    expected: { commissionCcy: 40.32, spreadCostCcy: 20, pnlCcy: -160.32, pnlR: -1.6032 },
  },
  {
    name: 'short · limit entry, stop exit · costs off',
    order: { id: FIXTURE_SHORT_ID, side: 'short', type: 'limit', entryPrice: 1005, qty: 20, riskAmountCcy: 100 },
    exitEvent: exit(FIXTURE_SHORT_ID, 1010, 'stop'), costs: OFF,
    expected: { commissionCcy: 0, spreadCostCcy: 0, pnlCcy: -100, pnlR: -1 },
  },
  {
    // short limit 1005 → tp 980, qty 20: gross 25 * 20 = 500; commission 20.1 + 19.6 = 39.7;
    // pnl 460.3; R 4.603; no spread
    name: 'short · limit entry, take-profit · costs on',
    order: { id: FIXTURE_SHORT_ID, side: 'short', type: 'limit', entryPrice: 1005, qty: 20, riskAmountCcy: 100 },
    exitEvent: exit(FIXTURE_SHORT_ID, 980, 'take-profit'), costs: ON,
    expected: { commissionCcy: 39.7, spreadCostCcy: 0, pnlCcy: 460.3, pnlR: 4.603 },
  },
];

// ---------------------------------------------------------------------------------------------
// §6 "MAE"
// ---------------------------------------------------------------------------------------------

export interface MaeFixture {
  name: string;
  order: Pick<Order, 'id' | 'side' | 'type' | 'entryPrice' | 'entryTimeMs' | 'exitTimeMs' | 'qty' | 'riskAmountCcy'>;
  path: PathBar[];
  expected: { maePrice: number; maeR: number };
}

export const MAE_FIXTURES: readonly MaeFixture[] = [
  {
    // limit filled on candle 1: window = candles 1..3 (fill candle included); the 900 low before
    // entry and the 950 low after exit are outside it. Worst low inside = 985 on candle 2
    // → mae 1000 - 985 = 15; maeR = 15 * 10 / 100 = 1.5
    name: 'long limit · worst low inside the fill→exit window',
    order: { id: FIXTURE_LONG_ID, side: 'long', type: 'limit', entryPrice: 1000, entryTimeMs: t(1), exitTimeMs: t(3), qty: 10, riskAmountCcy: 100 },
    path: [bar(0, 1000, 1001, 900, 1000), bar(1, 1000, 1002, 995, 998), bar(2, 998, 999, 985, 990),
      bar(3, 990, 1021, 990, 1020), bar(4, 1020, 1022, 950, 960)],
    expected: { maePrice: 15, maeR: 1.5 },
  },
  {
    // limit filled on candle 1, whose low 980 is the worst: the fill candle counts
    // → mae 1000 - 980 = 20; maeR = 20 * 10 / 100 = 2
    name: 'long limit · the fill candle is inside the window',
    order: { id: FIXTURE_LONG_ID, side: 'long', type: 'limit', entryPrice: 1000, entryTimeMs: t(1), exitTimeMs: t(2), qty: 10, riskAmountCcy: 100 },
    path: [bar(1, 1003, 1004, 980, 1001), bar(2, 1001, 1021, 995, 1020)],
    expected: { maePrice: 20, maeR: 2 },
  },
  {
    // market entry at candle 1's close: its low 970 printed before the trade existed and is
    // excluded. Worst low after it = 985 → mae 15; maeR 1.5
    name: 'long market · the entry candle is outside the window',
    order: { id: FIXTURE_LONG_ID, side: 'long', type: 'market', entryPrice: 1000, entryTimeMs: t(1), exitTimeMs: t(3), qty: 10, riskAmountCcy: 100 },
    path: [bar(1, 1001, 1002, 970, 999), bar(2, 999, 1001, 985, 990), bar(3, 990, 1021, 988, 1020)],
    expected: { maePrice: 15, maeR: 1.5 },
  },
  {
    // limit filled on candle 1; worst high inside = 1008 → mae 1008 - 1000 = 8; maeR = 8 * 20 / 100 = 1.6
    name: 'short limit · worst high inside the fill→exit window',
    order: { id: FIXTURE_SHORT_ID, side: 'short', type: 'limit', entryPrice: 1000, entryTimeMs: t(1), exitTimeMs: t(3), qty: 20, riskAmountCcy: 100 },
    path: [bar(0, 1000, 1100, 999, 1000), bar(1, 1000, 1003, 995, 1001), bar(2, 1001, 1008, 996, 1000),
      bar(3, 1000, 1001, 979, 980), bar(4, 980, 1050, 978, 1040)],
    expected: { maePrice: 8, maeR: 1.6 },
  },
  {
    // market entry at candle 1's close: its high 1030 is excluded. Worst high after = 1006
    // → mae 6; maeR = 6 * 10 / 100 = 0.6
    name: 'short market · the entry candle is outside the window',
    order: { id: FIXTURE_SHORT_ID, side: 'short', type: 'market', entryPrice: 1000, entryTimeMs: t(1), exitTimeMs: t(3), qty: 10, riskAmountCcy: 100 },
    path: [bar(1, 999, 1030, 998, 1001), bar(2, 1001, 1006, 995, 997), bar(3, 997, 999, 979, 980)],
    expected: { maePrice: 6, maeR: 0.6 },
  },
  {
    // every low after entry stays above the (spread-paying) entry 1001 → no adverse excursion, floored at 0
    name: 'long market · never traded below entry → 0',
    order: { id: FIXTURE_LONG_ID, side: 'long', type: 'market', entryPrice: 1001, entryTimeMs: t(0), exitTimeMs: t(2), qty: 10, riskAmountCcy: 100 },
    path: [bar(0, 1000, 1001, 998, 1000), bar(1, 1002, 1010, 1002, 1008), bar(2, 1008, 1021, 1005, 1020)],
    expected: { maePrice: 0, maeR: 0 },
  },
];

// ---------------------------------------------------------------------------------------------
// §6 "Floating mark" and openRisk
// ---------------------------------------------------------------------------------------------

export interface FloatingPnlFixture {
  name: string;
  position: Pick<Order, 'id' | 'side' | 'entryPrice' | 'qty'>;
  lastClose: number;
  costs: Costs;
  expected: number;
}

export const FLOATING_PNL_FIXTURES: readonly FloatingPnlFixture[] = [
  // mark 1010 - 1 = 1009: (1009 - 1001) * 10 = 80, minus 10.01 + 10.09 = 59.9
  { name: 'long · in profit · costs on', position: { id: FIXTURE_LONG_ID, side: 'long', entryPrice: 1001, qty: 10 }, lastClose: 1010, costs: ON, expected: 59.9 },
  { name: 'long · in profit · costs off', position: { id: FIXTURE_LONG_ID, side: 'long', entryPrice: 1000, qty: 10 }, lastClose: 1010, costs: OFF, expected: 100 },
  // entered at 1001, last close 1001: marking at 1000 already loses the spread plus both fees:
  // -10 - 10.01 - 10.00 = -30.01
  { name: 'long · flat price shows the round-trip cost · costs on', position: { id: FIXTURE_LONG_ID, side: 'long', entryPrice: 1001, qty: 10 }, lastClose: 1001, costs: ON, expected: -30.01 },
  // mark 1010 + 1 = 1011: -(1011 - 999) * 10 = -120, minus 9.99 + 10.11 = -140.1
  { name: 'short · in loss · costs on', position: { id: FIXTURE_SHORT_ID, side: 'short', entryPrice: 999, qty: 10 }, lastClose: 1010, costs: ON, expected: -140.1 },
  { name: 'short · in loss · costs off', position: { id: FIXTURE_SHORT_ID, side: 'short', entryPrice: 1000, qty: 10 }, lastClose: 1010, costs: OFF, expected: -100 },
];

export interface OpenRiskFixture {
  name: string;
  positions: Pick<Order, 'id' | 'side' | 'entryPrice' | 'qty' | 'slCurrent'>[];
  expected: number;
}

export const OPEN_RISK_FIXTURES: readonly OpenRiskFixture[] = [
  { name: 'no open positions', positions: [], expected: 0 },
  {
    // long (1001 - 990) * 10 = 110; short (1010 - 1005) * 20 = 100;
    // long with its stop trailed to 1005 above entry 1000 locks in a gain → 0. Total 210.
    name: 'long + opposing short + a long whose stop is past entry',
    positions: [
      { id: FIXTURE_LONG_ID, side: 'long', entryPrice: 1001, qty: 10, slCurrent: 990 },
      { id: FIXTURE_SHORT_ID, side: 'short', entryPrice: 1005, qty: 20, slCurrent: 1010 },
      { id: '00000000-0000-4000-8000-000000000003', side: 'long', entryPrice: 1000, qty: 5, slCurrent: 1005 },
    ],
    expected: 210,
  },
];
