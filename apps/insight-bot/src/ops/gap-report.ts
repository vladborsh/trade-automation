/**
 * IB-011 — the daily gap report (design §6.2), as a pure function.
 *
 * **This is the stage-0 exit instrument**: fourteen consecutive clean reports are what the Tester
 * reads and the Architect confirms the cluster on. So it is built to be read by a person at 08:00,
 * and two rules follow from that:
 *
 * - **It must not cry wolf.** A collector that started mid-day has not "missed" the minutes before
 *   its first row (`expectedFrom` below), a symbol the venue does not serve is not a hole, and the
 *   OI/LS retention edge is not a gap (§16.8, IB-007). Counting those would make every early
 *   report red and teach the reader to ignore it.
 * - **It must not hide anything either.** Anything genuinely missing is listed with its symbol and
 *   count; `clean` is true only when every line is zero.
 *
 * WD-010: the minute-candle section is gone with the candle tape (the box no longer collects
 * candles — the chart reads them from the venue). What is left is what the box still stores:
 * OI/LS slots and the liquidation streams' unrepaired silence. WD-011 decides the report's fate.
 */

export interface SlotCoverage {
  venue: string;
  symbol: string;
  present: number;
  expected: number;
}

/** One `collector_gaps` row, as the report reads it. */
export interface GapRow {
  stream: string;
  venue: string;
  symbol: string | null;
  gapFromMs: number;
  gapToMs: number;
  expected: number;
  repaired: number;
  error: string | null;
}

export interface GapReportInput {
  /** The UTC day the report covers, as `YYYY-MM-DD`. */
  day: string;
  openInterest: readonly SlotCoverage[];
  longShort: readonly SlotCoverage[];
  gaps: readonly GapRow[];
  /** The highest `used1m` seen during the day, and whether it was the venue's own figure. */
  binanceWeightPeak: number;
  binanceWeightIsEstimate: boolean;
  /** §6.2: mark/liquidation silence longer than this is what the criterion forbids. */
  silenceThresholdMin: number;
}

export interface MissingLine {
  venue: string;
  market?: string;
  symbol: string;
  missing: number;
  expected: number;
}

export interface UnrepairedLine {
  stream: string;
  symbol: string | null;
  minutes: number;
  reason: string | null;
}

export interface GapReport {
  day: string;
  clean: boolean;
  openInterest: { symbols: number; missing: MissingLine[] };
  longShort: { symbols: number; missing: MissingLine[] };
  /** Silence on the liquidation streams that was never repaired (§6.2). */
  unrepaired: UnrepairedLine[];
  binanceWeight: { peak1m: number; isEstimate: boolean; budget: number };
  generatedAtMs: number;
}

export const BINANCE_WEIGHT_BUDGET = 2400;
/** Streams with no REST equivalent: silence there is loss, and the criterion names them (§6.2). */
export const EVENT_STREAMS = ['forceOrder', 'allLiquidation', 'liquidation-orders'];

const MINUTE_MS = 60_000;

export function buildGapReport(input: GapReportInput, generatedAtMs: number): GapReport {
  const slotMissing = (rows: readonly SlotCoverage[]): MissingLine[] =>
    rows
      .map((r) => ({ venue: r.venue, symbol: r.symbol, missing: Math.max(0, r.expected - r.present), expected: r.expected }))
      .filter((line) => line.missing > 0)
      .sort((a, b) => b.missing - a.missing);

  // A gap row counts as unrepaired when the collector could not fill it. The event streams have
  // no REST equivalent at all, so their rows are always unrepaired by construction (IB-005 writes
  // one per degraded spell); the criterion is about how LONG they were silent.
  const unrepaired: UnrepairedLine[] = input.gaps
    .filter((gap) => gap.repaired < gap.expected || (gap.expected === 0 && gap.repaired === 0))
    .map((gap) => ({
      stream: gap.stream,
      symbol: gap.symbol,
      minutes: Math.max(0, Math.round((gap.gapToMs - gap.gapFromMs) / MINUTE_MS)),
      reason: gap.error,
    }))
    .filter((line) => line.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  const overThreshold = unrepaired.filter((line) => line.minutes > input.silenceThresholdMin);

  return {
    day: input.day,
    clean: slotMissing(input.openInterest).length === 0 && slotMissing(input.longShort).length === 0 && overThreshold.length === 0,
    openInterest: { symbols: input.openInterest.length, missing: slotMissing(input.openInterest) },
    longShort: { symbols: input.longShort.length, missing: slotMissing(input.longShort) },
    unrepaired,
    binanceWeight: { peak1m: input.binanceWeightPeak, isEstimate: input.binanceWeightIsEstimate, budget: BINANCE_WEIGHT_BUDGET },
    generatedAtMs,
  };
}

/**
 * The report as the operator reads it in Telegram — plain Russian, every number said in words
 * first. Kept short on a clean day (that is most days, and a wall of text trains people to skip
 * it) and specific when something is missing.
 */
export function renderGapReport(report: GapReport, maxLines = 8): string {
  const lines: string[] = [];
  lines.push(`${report.clean ? '✅' : '⚠️'} Отчёт о пропусках за ${report.day} (UTC)`);
  lines.push('');

  const slots = (title: string, group: GapReport['openInterest']) => {
    if (group.symbols === 0) return;
    if (group.missing.length === 0) lines.push(`${title}: все пятиминутные слоты на месте (${group.symbols} монет).`);
    else {
      lines.push(`${title}: не хватает слотов у ${group.missing.length} монет.`);
      for (const line of group.missing.slice(0, maxLines)) lines.push(`  • ${line.symbol}: нет ${line.missing} из ${line.expected}`);
    }
  };
  slots('Открытый интерес', report.openInterest);
  slots('Лонг/шорт', report.longShort);

  if (report.unrepaired.length === 0) lines.push('Незакрытых пропусков в потоках нет.');
  else {
    lines.push('Незакрытые пропуски (данные потеряны безвозвратно):');
    for (const line of report.unrepaired.slice(0, maxLines)) {
      lines.push(`  • ${line.stream}${line.symbol ? ` ${line.symbol}` : ''}: ${line.minutes} мин${line.reason ? ` — ${line.reason}` : ''}`);
    }
  }

  const weight = report.binanceWeight;
  if (weight.peak1m === 0) {
    // a re-run from the CLI is a fresh process: it never saw the day's traffic, and printing
    // "0 из 2400" would read as "we used nothing", which is a different claim
    lines.push('Пик нагрузки на Binance: нет данных (отчёт пересобран отдельным запуском).');
  } else {
    lines.push(
      `Пик нагрузки на Binance: ${weight.peak1m} из ${weight.budget} за минуту (${((weight.peak1m / weight.budget) * 100).toFixed(1)} %)` +
        `${weight.isEstimate ? ', это наша собственная оценка — биржа заголовок не прислала' : ''}.`,
    );
  }
  return lines.join('\n');
}
