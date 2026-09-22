import { BacktestErrorCode, Coverage, CreateSessionRequest, InstrumentId, SessionLayout, TIMEFRAME_MS } from '@trade-automation/contracts';

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
  hasContract?: ReadonlySet<InstrumentId>,
): ValidatedSession | SessionValidationError {
  const instruments = [...new Set(req.layout.panels.map((p) => p.instrument))];

  for (const id of instruments) {
    if (!sessionCurrencyOf.has(id) || !coverageOf.get(id)) {
      return { code: 'INSTRUMENT_NOT_AVAILABLE', message: `Instrument ${id} has no stored 1m history to replay.` };
    }
    // D12 (T-053): an order is sized against the contract block; without one it cannot be traded.
    if (hasContract && !hasContract.has(id)) {
      return {
        code: 'INSTRUMENT_NOT_AVAILABLE',
        message: `Instrument ${id} has no contract specification (size step, minimum size, leverage cap) configured, so its orders cannot be sized.`,
      };
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

/**
 * T-029: a layout edit inside a session. The same checks as creation, against the session's own
 * (fixed) period, plus one rule: the layout may never change the session's currency group
 * (decision 36), so every panel's `sessionCurrency` must equal the session's. A layout that is
 * internally consistent but in another currency is also `MIXED_SESSION_CURRENCY`.
 */
export function validateLayoutEdit(
  layout: SessionLayout,
  session: { sessionCurrency: string; periodFromMs: number; periodToMs: number },
  sessionCurrencyOf: ReadonlyMap<InstrumentId, string>,
  coverageOf: ReadonlyMap<InstrumentId, Coverage | null>,
  hasContract?: ReadonlySet<InstrumentId>,
): SessionValidationError | null {
  const verdict = validateCreateSession(
    { layout, periodFromMs: session.periodFromMs, periodToMs: session.periodToMs },
    sessionCurrencyOf,
    coverageOf,
    hasContract,
  );
  if (isValidationError(verdict)) return verdict;
  if (verdict.sessionCurrency !== session.sessionCurrency) {
    return {
      code: 'MIXED_SESSION_CURRENCY',
      message: `This session trades in ${session.sessionCurrency}; its panels cannot move to ${verdict.sessionCurrency}.`,
    };
  }
  return null;
}

/**
 * T-029: the panels a layout edit would take away from pending or open orders. Orders carry
 * `panel_id`; a panel holding one may not disappear, and may not keep its id while pointing at a
 * different instrument (the order would then sit on a chart of something else).
 */
export function panelsLosingActiveOrders(
  next: SessionLayout,
  activeOrders: readonly { panelId: string; instrument: InstrumentId }[],
): string[] {
  const nextInstrument = new Map(next.panels.map((p) => [p.id, p.instrument]));
  const losing = activeOrders.filter((o) => nextInstrument.get(o.panelId) !== o.instrument).map((o) => o.panelId);
  return [...new Set(losing)];
}
