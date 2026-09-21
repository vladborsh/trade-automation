import { InstrumentId, SessionAggregates, SessionStats } from '@trade-automation/contracts';
import { StatsOrder } from '../stats/compute-stats';
import { FIXTURE_T0, fixtureTime as t } from './common';

/**
 * architecture/backtest-app-system-design.md §8 — reference fixtures for `computeStats` and the
 * aggregate projection. Every session starts at `FIXTURE_T0` with 10 000; trades close at
 * `t(10)`, `t(20)`, … Each expected figure is worked in the comment above it. Compare with a
 * tolerance (`toBeCloseTo`) — sums are float64.
 */

export const STATS_INITIAL_BALANCE = 10_000;
export const STATS_PERIOD_FROM_MS = FIXTURE_T0;

const BTC: InstrumentId = 'binance:BTCUSDT';
const US100: InstrumentId = 'capitalcom:US100';

interface TradeSpec {
  seq: number;
  instrument?: InstrumentId;
  side?: 'long' | 'short';
  exit: number; // minutes after T0
  pnl: number;
  r: number;
  mae?: number | null;
  pessimistic?: true;
  endOfSession?: true;
}

function closed(s: TradeSpec): StatsOrder {
  return {
    id: `00000000-0000-4000-8000-${String(s.seq).padStart(12, '0')}`,
    seq: s.seq,
    instrument: s.instrument ?? BTC,
    side: s.side ?? 'long',
    status: 'closed',
    exitTimeMs: t(s.exit),
    pnlCcy: s.pnl,
    pnlR: s.r,
    maeR: s.mae === undefined ? 0.5 : s.mae,
    fillResolution: s.pessimistic ? 'pessimistic-bar' : '1m',
    closeReason: s.endOfSession ? 'end-of-session' : s.pnl > 0 ? 'take-profit' : 'stop',
  };
}

export interface StatsFixture {
  name: string;
  orders: StatsOrder[];
  expected: SessionStats;
}

const EMPTY_BREAKDOWN = { trades: 0, pnl: 0, pnlR: 0, winRate: 0 };

export const STATS_FIXTURES: readonly StatsFixture[] = [
  {
    // No trades: the curve is the seed point alone; ratios are 0, averages / PF / MAE null.
    name: 'empty session',
    orders: [],
    expected: {
      trades: 0, wins: 0, losses: 0, breakeven: 0, winRate: 0,
      pnl: 0, pnlR: 0, grossProfit: 0, grossProfitR: 0, grossLoss: 0, grossLossR: 0, profitFactor: null,
      equityCurve: [{ time: FIXTURE_T0, balance: 10_000, balanceR: 0 }],
      maxDrawdownCcy: 0, maxDrawdownR: 0, maxDrawdownPct: 0,
      avgWin: null, avgWinR: null, avgLoss: null, avgLossR: null, expectancyR: 0,
      maeAvg: null, maeWorst: null, pessimisticTrades: 0, endOfSessionCloses: 0,
      byInstrument: {}, bySide: { long: EMPTY_BREAKDOWN, short: EMPTY_BREAKDOWN },
    },
  },
  {
    // One stop-out of -100 (-1R), resolved on session bars: 10 000 → 9 900.
    // Drawdown 100 = 1R = 100 / 10 000 = 1 %. A loss exists, so PF = 0 / 100 = 0, not null.
    name: 'single trade: one pessimistic stop-out',
    orders: [closed({ seq: 1, exit: 10, pnl: -100, r: -1, mae: 1.2, pessimistic: true })],
    expected: {
      trades: 1, wins: 0, losses: 1, breakeven: 0, winRate: 0,
      pnl: -100, pnlR: -1, grossProfit: 0, grossProfitR: 0, grossLoss: -100, grossLossR: -1, profitFactor: 0,
      equityCurve: [
        { time: FIXTURE_T0, balance: 10_000, balanceR: 0 },
        { time: t(10), balance: 9_900, balanceR: -1 },
      ],
      maxDrawdownCcy: 100, maxDrawdownR: 1, maxDrawdownPct: 1,
      avgWin: null, avgWinR: null, avgLoss: -100, avgLossR: -1, expectancyR: -1,
      maeAvg: 1.2, maeWorst: 1.2, pessimisticTrades: 1, endOfSessionCloses: 0,
      byInstrument: { [BTC]: { trades: 1, pnl: -100, pnlR: -1, winRate: 0 } },
      bySide: { long: { trades: 1, pnl: -100, pnlR: -1, winRate: 0 }, short: EMPTY_BREAKDOWN },
    },
  },
  {
    // +200 (2R), -300 (-3R), -100 (-1R), +500 (5R).
    // Curve 10 000 → 10 200 (peak) → 9 900 → 9 800 (trough) → 10 300 (recovered, new peak).
    // Drawdown on the stepped curve: 10 200 - 9 800 = 400; % = 400 / 10 200 * 100 = 3.9215686…
    // R curve 0 → 2 → -1 → -2 → 3: 2 - (-2) = 4R. The last trade's MAE of 3R is intrabar and
    // does not enter the drawdown.
    // wins 2, losses 2, winRate 0.5; gross +700 / -400 (+7R / -4R), PF 700 / 400 = 1.75;
    // avgWin 350 (3.5R), avgLoss -200 (-2R); pnl 300 (3R), expectancy 3 / 4 = 0.75R;
    // MAE 0.5, 1, 1, 3 → avg 1.375, worst 3.
    name: 'drawdown that is recovered, measured on the stepped curve',
    orders: [
      closed({ seq: 1, exit: 10, pnl: 200, r: 2, mae: 0.5 }),
      closed({ seq: 2, exit: 20, pnl: -300, r: -3, mae: 1 }),
      closed({ seq: 3, exit: 30, pnl: -100, r: -1, mae: 1 }),
      closed({ seq: 4, exit: 40, pnl: 500, r: 5, mae: 3 }),
    ],
    expected: {
      trades: 4, wins: 2, losses: 2, breakeven: 0, winRate: 0.5,
      pnl: 300, pnlR: 3, grossProfit: 700, grossProfitR: 7, grossLoss: -400, grossLossR: -4, profitFactor: 1.75,
      equityCurve: [
        { time: FIXTURE_T0, balance: 10_000, balanceR: 0 },
        { time: t(10), balance: 10_200, balanceR: 2 },
        { time: t(20), balance: 9_900, balanceR: -1 },
        { time: t(30), balance: 9_800, balanceR: -2 },
        { time: t(40), balance: 10_300, balanceR: 3 },
      ],
      maxDrawdownCcy: 400, maxDrawdownR: 4, maxDrawdownPct: (400 / 10_200) * 100,
      avgWin: 350, avgWinR: 3.5, avgLoss: -200, avgLossR: -2, expectancyR: 0.75,
      maeAvg: 1.375, maeWorst: 3, pessimisticTrades: 0, endOfSessionCloses: 0,
      byInstrument: { [BTC]: { trades: 4, pnl: 300, pnlR: 3, winRate: 0.5 } },
      bySide: { long: { trades: 4, pnl: 300, pnlR: 3, winRate: 0.5 }, short: EMPTY_BREAKDOWN },
    },
  },
  {
    // +100 (1R), +250 (2.5R); the second has no MAE recorded.
    // No losses → PF null, avgLoss null; curve only rises → no drawdown.
    // MAE over the one non-null value: 0.4.
    name: 'only wins: profit factor null',
    orders: [
      closed({ seq: 1, side: 'short', exit: 10, pnl: 100, r: 1, mae: 0.4 }),
      closed({ seq: 2, side: 'short', exit: 20, pnl: 250, r: 2.5, mae: null }),
    ],
    expected: {
      trades: 2, wins: 2, losses: 0, breakeven: 0, winRate: 1,
      pnl: 350, pnlR: 3.5, grossProfit: 350, grossProfitR: 3.5, grossLoss: 0, grossLossR: 0, profitFactor: null,
      equityCurve: [
        { time: FIXTURE_T0, balance: 10_000, balanceR: 0 },
        { time: t(10), balance: 10_100, balanceR: 1 },
        { time: t(20), balance: 10_350, balanceR: 3.5 },
      ],
      maxDrawdownCcy: 0, maxDrawdownR: 0, maxDrawdownPct: 0,
      avgWin: 175, avgWinR: 1.75, avgLoss: null, avgLossR: null, expectancyR: 1.75,
      maeAvg: 0.4, maeWorst: 0.4, pessimisticTrades: 0, endOfSessionCloses: 0,
      byInstrument: { [BTC]: { trades: 2, pnl: 350, pnlR: 3.5, winRate: 1 } },
      bySide: { long: EMPTY_BREAKDOWN, short: { trades: 2, pnl: 350, pnlR: 3.5, winRate: 1 } },
    },
  },
  {
    // BTC long +300 (3R) · US100 short -100 (-1R, pessimistic) · BTC short 0 (0R, breakeven) ·
    // US100 long +50 (0.5R, end-of-session).
    // Curve 10 000 → 10 300 → 10 200 → 10 200 → 10 250; drawdown 100 = 1R = 100 / 10 300 * 100 %.
    // wins 2, losses 1, breakeven 1 → winRate 2 / 4 = 0.5 (the breakeven counts as a non-win).
    // gross +350 / -100 (+3.5R / -1R), PF 3.5; avgWin 175 (1.75R), avgLoss -100 (-1R);
    // pnl 250 (2.5R), expectancy 2.5 / 4 = 0.625R; MAE 0.2, 1, 0.5, 0.3 → avg 0.5, worst 1.
    // BTC: 2 trades, +300 (3R), 1 win of 2 → 0.5. US100: 2 trades, -50 (-0.5R), 1 of 2 → 0.5.
    // long: 2 trades, +350 (3.5R), 2 of 2 → 1. short: 2 trades, -100 (-1R), 0 of 2 → 0.
    name: 'mixed instruments and sides, with a breakeven',
    orders: [
      closed({ seq: 1, instrument: BTC, side: 'long', exit: 10, pnl: 300, r: 3, mae: 0.2 }),
      closed({ seq: 2, instrument: US100, side: 'short', exit: 20, pnl: -100, r: -1, mae: 1, pessimistic: true }),
      closed({ seq: 3, instrument: BTC, side: 'short', exit: 30, pnl: 0, r: 0, mae: 0.5 }),
      closed({ seq: 4, instrument: US100, side: 'long', exit: 40, pnl: 50, r: 0.5, mae: 0.3, endOfSession: true }),
    ],
    expected: {
      trades: 4, wins: 2, losses: 1, breakeven: 1, winRate: 0.5,
      pnl: 250, pnlR: 2.5, grossProfit: 350, grossProfitR: 3.5, grossLoss: -100, grossLossR: -1, profitFactor: 3.5,
      equityCurve: [
        { time: FIXTURE_T0, balance: 10_000, balanceR: 0 },
        { time: t(10), balance: 10_300, balanceR: 3 },
        { time: t(20), balance: 10_200, balanceR: 2 },
        { time: t(30), balance: 10_200, balanceR: 2 },
        { time: t(40), balance: 10_250, balanceR: 2.5 },
      ],
      maxDrawdownCcy: 100, maxDrawdownR: 1, maxDrawdownPct: (100 / 10_300) * 100,
      avgWin: 175, avgWinR: 1.75, avgLoss: -100, avgLossR: -1, expectancyR: 0.625,
      maeAvg: 0.5, maeWorst: 1, pessimisticTrades: 1, endOfSessionCloses: 1,
      byInstrument: {
        [BTC]: { trades: 2, pnl: 300, pnlR: 3, winRate: 0.5 },
        [US100]: { trades: 2, pnl: -50, pnlR: -0.5, winRate: 0.5 },
      },
      bySide: {
        long: { trades: 2, pnl: 350, pnlR: 3.5, winRate: 1 },
        short: { trades: 2, pnl: -100, pnlR: -1, winRate: 0 },
      },
    },
  },
  {
    // 1R varies between trades, so the currency and R curves bottom out at different trades:
    // +300 (1R) · -100 (-2R) · +50 (2R) · -120 (-0.8R).
    // Currency 10 000 → 10 300 (peak) → 10 200 → 10 250 → 10 130: max drawdown 10 300 - 10 130 =
    // 170 at the 4th close; % = 170 / 10 300 * 100.
    // R 0 → 1 (peak) → -1 → 1 → 0.2: max drawdown 1 - (-1) = 2R at the 2nd close — each curve is
    // measured against its own running peak.
    // gross +350 / -220 (+3R / -2.8R), PF 350 / 220; avgWin 175 (1.5R), avgLoss -110 (-1.4R);
    // pnl 130 (0.2R), expectancy 0.2 / 4 = 0.05R.
    name: 'currency and R drawdowns peak at different trades',
    orders: [
      closed({ seq: 1, exit: 10, pnl: 300, r: 1 }),
      closed({ seq: 2, exit: 20, pnl: -100, r: -2 }),
      closed({ seq: 3, exit: 30, pnl: 50, r: 2 }),
      closed({ seq: 4, exit: 40, pnl: -120, r: -0.8 }),
    ],
    expected: {
      trades: 4, wins: 2, losses: 2, breakeven: 0, winRate: 0.5,
      pnl: 130, pnlR: 0.2, grossProfit: 350, grossProfitR: 3, grossLoss: -220, grossLossR: -2.8,
      profitFactor: 350 / 220,
      equityCurve: [
        { time: FIXTURE_T0, balance: 10_000, balanceR: 0 },
        { time: t(10), balance: 10_300, balanceR: 1 },
        { time: t(20), balance: 10_200, balanceR: -1 },
        { time: t(30), balance: 10_250, balanceR: 1 },
        { time: t(40), balance: 10_130, balanceR: 0.2 },
      ],
      maxDrawdownCcy: 170, maxDrawdownR: 2, maxDrawdownPct: (170 / 10_300) * 100,
      avgWin: 175, avgWinR: 1.5, avgLoss: -110, avgLossR: -1.4, expectancyR: 0.05,
      maeAvg: 0.5, maeWorst: 0.5, pessimisticTrades: 0, endOfSessionCloses: 0,
      byInstrument: { [BTC]: { trades: 4, pnl: 130, pnlR: 0.2, winRate: 0.5 } },
      bySide: { long: { trades: 4, pnl: 130, pnlR: 0.2, winRate: 0.5 }, short: EMPTY_BREAKDOWN },
    },
  },
  {
    // Two closes in the same minute are ordered by seq: seq 1 (-200) before seq 2 (+200), so the
    // curve dips to 9 800 before returning to 10 000 → drawdown 200 = 2R = 2 %. Inputs are given
    // in reverse to show the order comes from (exitTimeMs, seq), not the array.
    name: 'same-minute closes ordered by seq',
    orders: [
      closed({ seq: 2, exit: 10, pnl: 200, r: 2 }),
      closed({ seq: 1, exit: 10, pnl: -200, r: -2 }),
    ],
    expected: {
      trades: 2, wins: 1, losses: 1, breakeven: 0, winRate: 0.5,
      pnl: 0, pnlR: 0, grossProfit: 200, grossProfitR: 2, grossLoss: -200, grossLossR: -2, profitFactor: 1,
      equityCurve: [
        { time: FIXTURE_T0, balance: 10_000, balanceR: 0 },
        { time: t(10), balance: 9_800, balanceR: -2 },
        { time: t(10), balance: 10_000, balanceR: 0 },
      ],
      maxDrawdownCcy: 200, maxDrawdownR: 2, maxDrawdownPct: 2,
      avgWin: 200, avgWinR: 2, avgLoss: -200, avgLossR: -2, expectancyR: 0,
      maeAvg: 0.5, maeWorst: 0.5, pessimisticTrades: 0, endOfSessionCloses: 0,
      byInstrument: { [BTC]: { trades: 2, pnl: 0, pnlR: 0, winRate: 0.5 } },
      bySide: { long: { trades: 2, pnl: 0, pnlR: 0, winRate: 0.5 }, short: EMPTY_BREAKDOWN },
    },
  },
];

export interface AggregatesFixture {
  name: string;
  /** Index into `STATS_FIXTURES`. */
  statsFixture: number;
  statsComputedAt: number | null;
  expected: SessionAggregates;
}

export const AGGREGATES_FIXTURES: readonly AggregatesFixture[] = [
  {
    name: 'empty session',
    statsFixture: 0,
    statsComputedAt: null,
    expected: {
      tradesCount: 0, winsCount: 0, lossesCount: 0, pnlCcy: 0, pnlR: 0, profitFactor: null,
      maxDrawdownCcy: 0, maxDrawdownR: 0, avgWinCcy: null, avgWinR: null, avgLossCcy: null, avgLossR: null,
      statsComputedAt: null,
    },
  },
  {
    name: 'drawdown that is recovered',
    statsFixture: 2,
    statsComputedAt: 1_790_000_000_000,
    expected: {
      tradesCount: 4, winsCount: 2, lossesCount: 2, pnlCcy: 300, pnlR: 3, profitFactor: 1.75,
      maxDrawdownCcy: 400, maxDrawdownR: 4, avgWinCcy: 350, avgWinR: 3.5, avgLossCcy: -200, avgLossR: -2,
      statsComputedAt: 1_790_000_000_000,
    },
  },
];
