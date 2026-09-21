import { BacktestErrorCode, Coverage, CreateSessionRequest, InstrumentId, TIMEFRAME_MS } from '@trade-automation/contracts';

/**
 * architecture/backtest-app-system-design.md §7.2 — the checks behind POST /backtest/sessions'
 * 422 codes. Pure: the service feeds in the configured instruments and each one's 1m coverage.
 */

export interface SessionValidationError {
  code: BacktestErrorCode;
  message: string;
}

const MAX_SESSION_PANELS = 4;

/**
 * Runs on the raw body *before* `CreateSessionRequestSchema`, because that schema already caps
 * panels at 4 and fixes `kind: 'candles'` — parsing first would turn both into a generic 400 and
 * the two named 422 codes (D10) would be unreachable. Anything that is not an array of objects is
 * left to the schema.
 */
export function checkLayoutPanels(body: unknown): SessionValidationError | null {
  const panels = (body as { layout?: { panels?: unknown } } | null)?.layout?.panels;
  if (!Array.isArray(panels)) return null;
  if (panels.length > MAX_SESSION_PANELS) {
    return { code: 'LAYOUT_TOO_MANY_PANELS', message: `A session layout has at most ${MAX_SESSION_PANELS} panels (got ${panels.length}).` };
  }
  const notCandles = panels.find((p) => typeof p === 'object' && p !== null && (p as { kind?: unknown }).kind !== 'candles');
  if (notCandles) {
    const id = (notCandles as { id?: unknown }).id;
    return { code: 'LAYOUT_NOT_CANDLES', message: `Session layouts hold candle panels only; panel '${String(id)}' is not one.` };
  }
  return null;
}

/**
 * Period sanity that no §7.2 code names: a request that fails it is malformed (400), like any
 * other schema failure, not a 422 domain refusal.
 */
export function periodShapeError(req: Pick<CreateSessionRequest, 'periodFromMs' | 'periodToMs'>): string | null {
  return req.periodFromMs < req.periodToMs ? null : 'periodFromMs must be before periodToMs.';
}

export interface ValidatedSession {
  sessionCurrency: string;
}

/**
 * The domain checks, in order:
 * 1. `INSTRUMENT_NOT_AVAILABLE` — a panel's instrument is not configured, or has no stored 1m.
 * 2. `MIXED_SESSION_CURRENCY` — the panels' `sessionCurrency` values differ (D11; no fallback).
 * 3. `PERIOD_OUTSIDE_COVERAGE` — the period does not intersect some panel's 1m coverage.
 *    Coverage `to` is the last stored 1m *openTime*, so the covered span is `[from, to + 1m)`.
 */
export function validateCreateSession(
  req: Pick<CreateSessionRequest, 'layout' | 'periodFromMs' | 'periodToMs'>,
  sessionCurrencyOf: ReadonlyMap<InstrumentId, string>,
  coverageOf: ReadonlyMap<InstrumentId, Coverage | null>,
): ValidatedSession | SessionValidationError {
  const instruments = [...new Set(req.layout.panels.map((p) => p.instrument))];

  for (const id of instruments) {
    if (!sessionCurrencyOf.has(id) || !coverageOf.get(id)) {
      return { code: 'INSTRUMENT_NOT_AVAILABLE', message: `Instrument ${id} has no stored 1m history to replay.` };
    }
  }

  const currencies = [...new Set(instruments.map((id) => sessionCurrencyOf.get(id)!))];
  if (currencies.length > 1) {
    return {
      code: 'MIXED_SESSION_CURRENCY',
      message: `All panels must share one session currency; got ${currencies.join(', ')}.`,
    };
  }

  for (const id of instruments) {
    const coverage = coverageOf.get(id)!;
    const coveredTo = coverage.to + TIMEFRAME_MS['1m'];
    if (!(req.periodFromMs < coveredTo && coverage.from < req.periodToMs)) {
      return {
        code: 'PERIOD_OUTSIDE_COVERAGE',
        message: `The period does not overlap the stored 1m history of ${id}.`,
      };
    }
  }

  return { sessionCurrency: currencies[0] };
}

export function isValidationError(v: ValidatedSession | SessionValidationError): v is SessionValidationError {
  return 'code' in v;
}
