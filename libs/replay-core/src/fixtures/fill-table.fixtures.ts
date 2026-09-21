import { Costs, OrderSide } from '@trade-automation/contracts';
import { EngineFillEvent, EvaluableOrder, PathBar } from '../fill/types';
import {
  FIXTURE_COSTS_OFF,
  FIXTURE_COSTS_ON,
  FIXTURE_LONG_ID,
  FIXTURE_SHORT_ID,
  fixtureBar as bar,
  fixtureTime as t,
} from './common';

/**
 * architecture/backtest-app-system-design.md §6 — the fill table as data. Each fixture names the
 * table row it checks; `expected` is written out literally for costs on (half-spread 1) and off,
 * so a reader can verify it against the row by hand. The engine spec runs every fixture, and the
 * server (T-017) and the Tester reuse the same list.
 *
 * Levels. Long: limit 995, stop 990, target 1020, entry 1000 once open.
 *         Short: limit 1005, stop 1010, target 980, entry 1000 once open.
 * Candles are `bar(i, open, high, low, close)`, `i` minutes after `FIXTURE_T0`. Open positions
 * entered on candle -1 (`entryTimeMs = t(-1)`), just before each path starts.
 */

export type FillTableRow =
  | 'Limit entry'
  | 'Stop exit'
  | 'Take-profit exit'
  | 'SL and TP both inside one 1m candle'
  | 'Limit fill and SL/TP in the same candle'
  | 'No event';

export interface FillTableFixture {
  /** "<row> · <side> · <case> · costs on|off [· pessimistic-bar]" */
  name: string;
  row: FillTableRow;
  side: OrderSide;
  costs: Costs;
  /** `'1m'` → `evaluateOrder`; `'pessimistic-bar'` → `walkBarsPessimistic`. */
  walk: '1m' | 'pessimistic-bar';
  order: EvaluableOrder;
  path: PathBar[];
  expected: EngineFillEvent[];
}

const LONG_OPEN: EvaluableOrder = {
  id: FIXTURE_LONG_ID, side: 'long', type: 'market', status: 'open',
  limitPrice: null, entryPrice: 1000, entryTimeMs: t(-1), slCurrent: 990, tpCurrent: 1020,
};
const LONG_PENDING: EvaluableOrder = {
  id: FIXTURE_LONG_ID, side: 'long', type: 'limit', status: 'pending',
  limitPrice: 995, entryPrice: null, entryTimeMs: null, slCurrent: 990, tpCurrent: 1020,
};
const SHORT_OPEN: EvaluableOrder = {
  id: FIXTURE_SHORT_ID, side: 'short', type: 'market', status: 'open',
  limitPrice: null, entryPrice: 1000, entryTimeMs: t(-1), slCurrent: 1010, tpCurrent: 980,
};
const SHORT_PENDING: EvaluableOrder = {
  id: FIXTURE_SHORT_ID, side: 'short', type: 'limit', status: 'pending',
  limitPrice: 1005, entryPrice: null, entryTimeMs: null, slCurrent: 1010, tpCurrent: 980,
};

type Walk = FillTableFixture['walk'];
type Ev = { i: number; price: number; reason?: 'stop' | 'take-profit'; same?: true };

function events(order: EvaluableOrder, walk: Walk, fill: Ev | null, exit: Ev | null): EngineFillEvent[] {
  const out: EngineFillEvent[] = [];
  if (fill) out.push({ orderId: order.id, kind: 'fill', time: t(fill.i), price: fill.price, resolution: walk });
  if (exit) {
    const e: EngineFillEvent = {
      orderId: order.id, kind: 'exit', time: t(exit.i), price: exit.price, reason: exit.reason, resolution: walk,
    };
    out.push(exit.same ? { ...e, slTpSameBar: true } : e);
  }
  return out;
}

/** One case, expanded into a costs-on and a costs-off fixture. */
function row(
  rowName: FillTableRow,
  caseName: string,
  order: EvaluableOrder,
  path: PathBar[],
  on: { fill?: Ev; exit?: Ev },
  off: { fill?: Ev; exit?: Ev },
  walk: Walk = '1m',
): FillTableFixture[] {
  const suffix = walk === 'pessimistic-bar' ? ' · pessimistic-bar' : '';
  return [
    ['on', FIXTURE_COSTS_ON, on] as const,
    ['off', FIXTURE_COSTS_OFF, off] as const,
  ].map(([label, costs, exp]) => ({
    name: `${rowName} · ${order.side} · ${caseName} · costs ${label}${suffix}`,
    row: rowName,
    side: order.side,
    costs,
    walk,
    order,
    path,
    expected: events(order, walk, exp.fill ?? null, exp.exit ?? null),
  }));
}

const LONG: FillTableFixture[] = [
  // Limit entry: first candle with low <= 995, at 995 — no spread either way.
  ...row('Limit entry', 'fills on the first candle whose low reaches the limit', LONG_PENDING,
    [bar(0, 1000, 1002, 997, 999), bar(1, 999, 1000, 995, 998), bar(2, 998, 1005, 996, 1001)],
    { fill: { i: 1, price: 995 } },
    { fill: { i: 1, price: 995 } }),
  ...row('Limit entry', 'limit gapped through at the open still fills at the limit', LONG_PENDING,
    [bar(0, 993, 997, 992, 996)],
    { fill: { i: 0, price: 995 } },
    { fill: { i: 0, price: 995 } }),
  ...row('No event', 'limit not reached', LONG_PENDING,
    [bar(0, 1000, 1002, 996, 999)], {}, {}),

  // Stop exit: first candle with low <= 990; sl - half, or open - half when open < sl.
  ...row('Stop exit', 'touch', LONG_OPEN,
    [bar(0, 1000, 1004, 996, 998), bar(1, 998, 999, 989, 991)],
    { exit: { i: 1, price: 989, reason: 'stop' } },
    { exit: { i: 1, price: 990, reason: 'stop' } }),
  ...row('Stop exit', 'gap-through: open 985 < sl 990', LONG_OPEN,
    [bar(0, 985, 988, 980, 986)],
    { exit: { i: 0, price: 984, reason: 'stop' } },
    { exit: { i: 0, price: 985, reason: 'stop' } }),

  // Take-profit exit: first candle with high >= 1020, at tp, or at open when open > tp. No spread.
  ...row('Take-profit exit', 'touch', LONG_OPEN,
    [bar(0, 1010, 1021, 1008, 1019)],
    { exit: { i: 0, price: 1020, reason: 'take-profit' } },
    { exit: { i: 0, price: 1020, reason: 'take-profit' } }),
  ...row('Take-profit exit', 'gap-through: open 1025 > tp 1020', LONG_OPEN,
    [bar(0, 1025, 1030, 1022, 1028)],
    { exit: { i: 0, price: 1025, reason: 'take-profit' } },
    { exit: { i: 0, price: 1025, reason: 'take-profit' } }),
  ...row('No event', 'no target set, stop not reached', { ...LONG_OPEN, tpCurrent: null },
    [bar(0, 1000, 1100, 995, 1050)], {}, {}),
  ...row('No event', 'candles before entryTimeMs are not evaluated', { ...LONG_OPEN, entryTimeMs: t(1) },
    [bar(0, 1000, 1000, 980, 990), bar(1, 1000, 1004, 996, 1001)], {}, {}),
  // The entry candle itself: its low 980 printed before a market order placed at its close.
  ...row('Stop exit', 'the entry candle is not evaluated, only candles after it', { ...LONG_OPEN, entryTimeMs: t(0) },
    [bar(0, 1000, 1000, 980, 999), bar(1, 999, 1004, 996, 1001), bar(2, 1001, 1002, 989, 992)],
    { exit: { i: 2, price: 989, reason: 'stop' } },
    { exit: { i: 2, price: 990, reason: 'stop' } }),
  // A later walk over a filled limit's fill candle (open 985 below the stop) must not re-resolve
  // it with gap-through: it was settled, at the levels, by the walk that filled it.
  ...row('No event', 'a filled limit re-walked from its fill candle', { ...LONG_OPEN, type: 'limit',
    limitPrice: 995, entryPrice: 995, entryTimeMs: t(0) },
    [bar(0, 985, 996, 980, 994), bar(1, 994, 1000, 993, 998)], {}, {}),

  // Both inside one candle: stop first, flagged.
  ...row('SL and TP both inside one 1m candle', 'stop first', LONG_OPEN,
    [bar(0, 1000, 1025, 985, 1005)],
    { exit: { i: 0, price: 989, reason: 'stop', same: true } },
    { exit: { i: 0, price: 990, reason: 'stop', same: true } }),
  ...row('SL and TP both inside one 1m candle', 'stop first, with gap-through at open 988', LONG_OPEN,
    [bar(0, 988, 1025, 985, 1005)],
    { exit: { i: 0, price: 987, reason: 'stop', same: true } },
    { exit: { i: 0, price: 988, reason: 'stop', same: true } }),

  // Limit fill and SL/TP in the same candle: fill, then exits on that candle at their levels.
  ...row('Limit fill and SL/TP in the same candle', 'fill then stop', LONG_PENDING,
    [bar(0, 1000, 1001, 988, 992)],
    { fill: { i: 0, price: 995 }, exit: { i: 0, price: 989, reason: 'stop' } },
    { fill: { i: 0, price: 995 }, exit: { i: 0, price: 990, reason: 'stop' } }),
  ...row('Limit fill and SL/TP in the same candle', 'fill then target', LONG_PENDING,
    [bar(0, 998, 1022, 994, 1015)],
    { fill: { i: 0, price: 995 }, exit: { i: 0, price: 1020, reason: 'take-profit' } },
    { fill: { i: 0, price: 995 }, exit: { i: 0, price: 1020, reason: 'take-profit' } }),
  ...row('Limit fill and SL/TP in the same candle', 'fill then both → stop first', LONG_PENDING,
    [bar(0, 1000, 1025, 985, 1000)],
    { fill: { i: 0, price: 995 }, exit: { i: 0, price: 989, reason: 'stop', same: true } },
    { fill: { i: 0, price: 995 }, exit: { i: 0, price: 990, reason: 'stop', same: true } }),
  ...row('Limit fill and SL/TP in the same candle', 'open 985 below the stop: no gap-through on the fill candle',
    LONG_PENDING,
    [bar(0, 985, 993, 980, 990)],
    { fill: { i: 0, price: 995 }, exit: { i: 0, price: 989, reason: 'stop' } },
    { fill: { i: 0, price: 995 }, exit: { i: 0, price: 990, reason: 'stop' } }),
  ...row('Limit fill and SL/TP in the same candle', 'fill, exit on a later candle with gap-through',
    LONG_PENDING,
    [bar(0, 996, 999, 994, 997), bar(1, 997, 1000, 993, 998), bar(2, 980, 985, 975, 982)],
    { fill: { i: 0, price: 995 }, exit: { i: 2, price: 979, reason: 'stop' } },
    { fill: { i: 0, price: 995 }, exit: { i: 2, price: 980, reason: 'stop' } }),

  // Pessimistic fallback: the same table on session-timeframe bars, flagged 'pessimistic-bar'.
  ...row('SL and TP both inside one 1m candle', 'stop first on a session bar', LONG_OPEN,
    [bar(0, 1000, 1025, 985, 1005)],
    { exit: { i: 0, price: 989, reason: 'stop', same: true } },
    { exit: { i: 0, price: 990, reason: 'stop', same: true } }, 'pessimistic-bar'),
  ...row('Limit fill and SL/TP in the same candle', 'fill then both → stop first on a session bar', LONG_PENDING,
    [bar(0, 1000, 1025, 985, 1000)],
    { fill: { i: 0, price: 995 }, exit: { i: 0, price: 989, reason: 'stop', same: true } },
    { fill: { i: 0, price: 995 }, exit: { i: 0, price: 990, reason: 'stop', same: true } }, 'pessimistic-bar'),
  ...row('Take-profit exit', 'gap-through on a session bar', LONG_OPEN,
    [bar(0, 1000, 1004, 996, 1001), bar(5, 1025, 1030, 1022, 1028)],
    { exit: { i: 5, price: 1025, reason: 'take-profit' } },
    { exit: { i: 5, price: 1025, reason: 'take-profit' } }, 'pessimistic-bar'),
];

const SHORT: FillTableFixture[] = [
  // Limit entry: first candle with high >= 1005, at 1005.
  ...row('Limit entry', 'fills on the first candle whose high reaches the limit', SHORT_PENDING,
    [bar(0, 1000, 1003, 998, 1001), bar(1, 1001, 1005, 1000, 1002), bar(2, 1002, 1004, 995, 999)],
    { fill: { i: 1, price: 1005 } },
    { fill: { i: 1, price: 1005 } }),
  ...row('Limit entry', 'limit gapped through at the open still fills at the limit', SHORT_PENDING,
    [bar(0, 1007, 1008, 1003, 1004)],
    { fill: { i: 0, price: 1005 } },
    { fill: { i: 0, price: 1005 } }),
  ...row('No event', 'limit not reached', SHORT_PENDING,
    [bar(0, 1000, 1004, 998, 1001)], {}, {}),

  // Stop exit: first candle with high >= 1010; sl + half, or open + half when open > sl.
  ...row('Stop exit', 'touch', SHORT_OPEN,
    [bar(0, 1000, 1004, 996, 1002), bar(1, 1002, 1011, 1001, 1009)],
    { exit: { i: 1, price: 1011, reason: 'stop' } },
    { exit: { i: 1, price: 1010, reason: 'stop' } }),
  ...row('Stop exit', 'gap-through: open 1015 > sl 1010', SHORT_OPEN,
    [bar(0, 1015, 1020, 1012, 1014)],
    { exit: { i: 0, price: 1016, reason: 'stop' } },
    { exit: { i: 0, price: 1015, reason: 'stop' } }),

  // Take-profit exit: first candle with low <= 980, at tp, or at open when open < tp.
  ...row('Take-profit exit', 'touch', SHORT_OPEN,
    [bar(0, 990, 992, 979, 981)],
    { exit: { i: 0, price: 980, reason: 'take-profit' } },
    { exit: { i: 0, price: 980, reason: 'take-profit' } }),
  ...row('Take-profit exit', 'gap-through: open 975 < tp 980', SHORT_OPEN,
    [bar(0, 975, 978, 970, 972)],
    { exit: { i: 0, price: 975, reason: 'take-profit' } },
    { exit: { i: 0, price: 975, reason: 'take-profit' } }),
  ...row('No event', 'no target set, stop not reached', { ...SHORT_OPEN, tpCurrent: null },
    [bar(0, 1000, 1005, 900, 950)], {}, {}),
  ...row('No event', 'candles before entryTimeMs are not evaluated', { ...SHORT_OPEN, entryTimeMs: t(1) },
    [bar(0, 1000, 1020, 1000, 1010), bar(1, 1000, 1004, 996, 999)], {}, {}),
  // The entry candle itself: its high 1020 printed before a market order placed at its close.
  ...row('Stop exit', 'the entry candle is not evaluated, only candles after it', { ...SHORT_OPEN, entryTimeMs: t(0) },
    [bar(0, 1000, 1020, 1000, 1001), bar(1, 1001, 1004, 996, 999), bar(2, 999, 1011, 998, 1008)],
    { exit: { i: 2, price: 1011, reason: 'stop' } },
    { exit: { i: 2, price: 1010, reason: 'stop' } }),
  ...row('No event', 'a filled limit re-walked from its fill candle', { ...SHORT_OPEN, type: 'limit',
    limitPrice: 1005, entryPrice: 1005, entryTimeMs: t(0) },
    [bar(0, 1015, 1020, 1004, 1006), bar(1, 1006, 1007, 1000, 1002)], {}, {}),

  // Both inside one candle: stop first, flagged.
  ...row('SL and TP both inside one 1m candle', 'stop first', SHORT_OPEN,
    [bar(0, 1000, 1015, 975, 995)],
    { exit: { i: 0, price: 1011, reason: 'stop', same: true } },
    { exit: { i: 0, price: 1010, reason: 'stop', same: true } }),
  ...row('SL and TP both inside one 1m candle', 'stop first, with gap-through at open 1012', SHORT_OPEN,
    [bar(0, 1012, 1015, 975, 995)],
    { exit: { i: 0, price: 1013, reason: 'stop', same: true } },
    { exit: { i: 0, price: 1012, reason: 'stop', same: true } }),

  // Limit fill and SL/TP in the same candle.
  ...row('Limit fill and SL/TP in the same candle', 'fill then stop', SHORT_PENDING,
    [bar(0, 1000, 1012, 999, 1008)],
    { fill: { i: 0, price: 1005 }, exit: { i: 0, price: 1011, reason: 'stop' } },
    { fill: { i: 0, price: 1005 }, exit: { i: 0, price: 1010, reason: 'stop' } }),
  ...row('Limit fill and SL/TP in the same candle', 'fill then target', SHORT_PENDING,
    [bar(0, 1002, 1006, 978, 985)],
    { fill: { i: 0, price: 1005 }, exit: { i: 0, price: 980, reason: 'take-profit' } },
    { fill: { i: 0, price: 1005 }, exit: { i: 0, price: 980, reason: 'take-profit' } }),
  ...row('Limit fill and SL/TP in the same candle', 'fill then both → stop first', SHORT_PENDING,
    [bar(0, 1000, 1015, 975, 1000)],
    { fill: { i: 0, price: 1005 }, exit: { i: 0, price: 1011, reason: 'stop', same: true } },
    { fill: { i: 0, price: 1005 }, exit: { i: 0, price: 1010, reason: 'stop', same: true } }),
  ...row('Limit fill and SL/TP in the same candle', 'open 1015 above the stop: no gap-through on the fill candle',
    SHORT_PENDING,
    [bar(0, 1015, 1020, 1007, 1010)],
    { fill: { i: 0, price: 1005 }, exit: { i: 0, price: 1011, reason: 'stop' } },
    { fill: { i: 0, price: 1005 }, exit: { i: 0, price: 1010, reason: 'stop' } }),
  ...row('Limit fill and SL/TP in the same candle', 'fill, exit on a later candle with gap-through',
    SHORT_PENDING,
    [bar(0, 1004, 1006, 1001, 1003), bar(1, 1003, 1007, 1000, 1002), bar(2, 1020, 1025, 1015, 1018)],
    { fill: { i: 0, price: 1005 }, exit: { i: 2, price: 1021, reason: 'stop' } },
    { fill: { i: 0, price: 1005 }, exit: { i: 2, price: 1020, reason: 'stop' } }),

  // Pessimistic fallback.
  ...row('SL and TP both inside one 1m candle', 'stop first on a session bar', SHORT_OPEN,
    [bar(0, 1000, 1015, 975, 995)],
    { exit: { i: 0, price: 1011, reason: 'stop', same: true } },
    { exit: { i: 0, price: 1010, reason: 'stop', same: true } }, 'pessimistic-bar'),
  ...row('Limit fill and SL/TP in the same candle', 'fill then both → stop first on a session bar', SHORT_PENDING,
    [bar(0, 1000, 1015, 975, 1000)],
    { fill: { i: 0, price: 1005 }, exit: { i: 0, price: 1011, reason: 'stop', same: true } },
    { fill: { i: 0, price: 1005 }, exit: { i: 0, price: 1010, reason: 'stop', same: true } }, 'pessimistic-bar'),
  ...row('Take-profit exit', 'gap-through on a session bar', SHORT_OPEN,
    [bar(0, 1000, 1004, 996, 999), bar(5, 975, 978, 970, 972)],
    { exit: { i: 5, price: 975, reason: 'take-profit' } },
    { exit: { i: 5, price: 975, reason: 'take-profit' } }, 'pessimistic-bar'),
];

export const FILL_TABLE_FIXTURES: readonly FillTableFixture[] = [...LONG, ...SHORT];
