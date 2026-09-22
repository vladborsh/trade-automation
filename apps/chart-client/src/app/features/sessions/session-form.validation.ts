import { BACKTEST_BOUNDS, type BacktestInstrument, type Coverage, type CreateSessionRequest, type InstrumentId, type SessionLayout, type Timeframe } from '@trade-automation/contracts';
import { MAX_SESSION_PANELS } from './session-layout';

/**
 * backtest-app-system-design.md §7.2 — the create-session checks the server runs
 * (apps/signal-server/src/backtest/session-validation.ts), done early so a doomed request is
 * never sent. Same rules, same order: panels (<= 4, candles only by construction), availability
 * (stored 1m), one `sessionCurrency` with no fallback, then the period: `from < to`, overlapping
 * each instrument's 1m coverage `[from, to + 1m)`. On top of that the form keeps the period
 * inside the instruments' common coverage (the date inputs are bounded by it), which implies the
 * server's overlap rule. The server stays the authority; its 422 codes are shown via
 * session-messages.ts.
 */

const ONE_MINUTE_MS = 60_000;

export interface SessionFormFields {
  name: string;
  instruments: InstrumentId[];
  timeframe: Timeframe;
  periodFromMs: number | null;
  periodToMs: number | null;
  initialBalance: number | null;
  defaultRiskPct: number | null;
  costsEnabled: boolean;
  commissionPct: number | null;
  spread: number | null;
  skipWeekends: boolean;
}

export type SessionFormErrors = Partial<Record<keyof SessionFormFields, string>>;

export const DEFAULT_RISK_PCT = 1;

/** The covered span `[from, to + 1m)`: coverage `to` is the last stored 1m openTime. */
export function coveredSpan(coverage: Coverage): { from: number; to: number } {
  return { from: coverage.from, to: coverage.to + ONE_MINUTE_MS };
}

/** Where every chosen instrument has stored 1m; null when they do not overlap (or none chosen / one uncovered). */
export function commonCoverage(instruments: readonly InstrumentId[], catalogue: ReadonlyMap<InstrumentId, BacktestInstrument>): { from: number; to: number } | null {
  if (instruments.length === 0) return null;
  let from = -Infinity;
  let to = Infinity;
  for (const id of instruments) {
    const coverage = catalogue.get(id)?.coverage;
    if (!coverage) return null;
    const span = coveredSpan(coverage);
    from = Math.max(from, span.from);
    to = Math.min(to, span.to);
  }
  return from < to ? { from, to } : null;
}

/** The form's default period: the last 30 days (or all, if shorter) of the common coverage, to the minute. */
export const DEFAULT_PERIOD_DAYS = 30;
export function defaultPeriod(common: { from: number; to: number }): { from: number; to: number } {
  const to = Math.floor(common.to / ONE_MINUTE_MS) * ONE_MINUTE_MS;
  const from = Math.max(Math.ceil(common.from / ONE_MINUTE_MS) * ONE_MINUTE_MS, to - DEFAULT_PERIOD_DAYS * 86_400_000);
  return { from, to };
}

/** True when the period is set and inside `common`: the selection change kept it valid. */
export function periodFits(fromMs: number | null, toMs: number | null, common: { from: number; to: number } | null): boolean {
  return fromMs !== null && toMs !== null && common !== null && fromMs >= common.from && toMs <= common.to && fromMs < toMs;
}

export function sessionCurrencies(instruments: readonly InstrumentId[], catalogue: ReadonlyMap<InstrumentId, BacktestInstrument>): string[] {
  return [...new Set(instruments.map((id) => catalogue.get(id)?.sessionCurrency).filter((c): c is string => c !== undefined))];
}

export function validateSessionForm(f: SessionFormFields, catalogue: ReadonlyMap<InstrumentId, BacktestInstrument>): SessionFormErrors {
  const errors: SessionFormErrors = {};
  if (f.name.trim().length === 0) errors.name = 'Give the session a name.';

  const instrumentError = validateInstruments(f.instruments, catalogue);
  if (instrumentError) errors.instruments = instrumentError;

  const periodError = validatePeriod(f, catalogue, instrumentError === null);
  if (periodError) errors.periodFromMs = periodError;

  // BUG-002: the same bounds as the contract (BACKTEST_BOUNDS), so an out-of-range value is caught
  // here rather than refused by the server with a 400.
  const B = BACKTEST_BOUNDS;
  if (!positive(f.initialBalance)) errors.initialBalance = 'Enter a starting balance above 0.';
  else if (f.initialBalance! >= B.moneyMaxExclusive) errors.initialBalance = 'Enter a starting balance below 1 000 000 000 000.';
  if (!positive(f.defaultRiskPct)) errors.defaultRiskPct = 'Enter a risk % above 0.';
  else if (f.defaultRiskPct! < B.riskPctMin || f.defaultRiskPct! > B.riskPctMax) {
    errors.defaultRiskPct = `Enter a risk % between ${B.riskPctMin} and ${B.riskPctMax}.`;
  }
  if (f.costsEnabled) {
    if (!nonNegative(f.commissionPct)) errors.commissionPct = 'Commission must be 0 or more.';
    else if (f.commissionPct! > B.commissionPctMax) errors.commissionPct = `Commission must be at most ${B.commissionPctMax} %.`;
    if (!nonNegative(f.spread)) errors.spread = 'Spread must be 0 or more.';
    else if (f.spread! >= B.moneyMaxExclusive) errors.spread = 'Spread must be below 1 000 000 000 000.';
  }
  return errors;
}

function validateInstruments(instruments: readonly InstrumentId[], catalogue: ReadonlyMap<InstrumentId, BacktestInstrument>): string | null {
  if (instruments.length === 0) return 'Pick at least one instrument.';
  if (instruments.length > MAX_SESSION_PANELS) return `A session holds at most ${MAX_SESSION_PANELS} instruments.`;
  const missing = instruments.find((id) => !catalogue.get(id)?.coverage);
  if (missing) return `${missing} has no stored 1m history to replay.`;
  const currencies = sessionCurrencies(instruments, catalogue);
  if (currencies.length > 1) return `All instruments must share one session currency; these mix ${currencies.join(' and ')}.`;
  return null;
}

function validatePeriod(f: SessionFormFields, catalogue: ReadonlyMap<InstrumentId, BacktestInstrument>, instrumentsOk: boolean): string | null {
  if (f.periodFromMs === null || f.periodToMs === null) return 'Enter the start and the end of the period.';
  if (f.periodFromMs >= f.periodToMs) return 'The period must start before it ends.';
  if (!instrumentsOk) return null; // nothing sensible to check the period against yet
  for (const id of f.instruments) {
    const span = coveredSpan(catalogue.get(id)!.coverage!);
    if (!(f.periodFromMs < span.to && span.from < f.periodToMs)) return `The period does not overlap the stored 1m history of ${id}.`;
  }
  const common = commonCoverage(f.instruments, catalogue);
  if (!common) return 'The chosen instruments have no stored history in common.';
  if (f.periodFromMs < common.from || f.periodToMs > common.to) return 'Keep the period inside the history all chosen instruments share.';
  return null;
}

export function hasErrors(errors: SessionFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** The POST body; only called once `validateSessionForm` returned no errors. */
export function toCreateRequest(f: SessionFormFields, layout: SessionLayout): CreateSessionRequest {
  return {
    name: f.name.trim(),
    layout,
    timeframe: f.timeframe,
    periodFromMs: f.periodFromMs!,
    periodToMs: f.periodToMs!,
    initialBalance: f.initialBalance!,
    defaultRiskPct: f.defaultRiskPct!,
    costs: { enabled: f.costsEnabled, commissionPct: f.costsEnabled ? f.commissionPct! : 0, spread: f.costsEnabled ? f.spread! : 0 },
    skipWeekends: f.skipWeekends,
  };
}

function positive(v: number | null): boolean {
  return v !== null && Number.isFinite(v) && v > 0;
}

function nonNegative(v: number | null): boolean {
  return v !== null && Number.isFinite(v) && v >= 0;
}
