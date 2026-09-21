import {
  BadRequestException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Coverage,
  CreateSessionRequestSchema,
  InstrumentId,
  PatchSessionRequest,
  Session,
  SessionDetail,
  SessionSchema,
  SessionSummary,
} from '@trade-automation/contracts';
import { computeStats } from '@trade-automation/replay-core';
import { z } from 'zod';
import { apiError } from '../auth/auth-error';
import { AppConfigService } from '../config/config.service';
import { CANDLE_STORE, CandleStore } from '../storage/candle-store.port';
import { BACKTEST_REPOSITORIES, BacktestRepositories } from './session.repository.port';
import { checkLayoutPanels, isValidationError, periodShapeError, validateCreateSession } from './session-validation';

/** §7.2 defaults: `skipWeekends` true (§13, decision 19), `notionalWarnMultiple` 5 (§13, decision 25). */
export const DEFAULT_SKIP_WEEKENDS = true;
export const DEFAULT_NOTIONAL_WARN_MULTIPLE = 5;

const UuidSchema = z.string().uuid();

/** The `Session` wire shape of a stored row (drops the aggregate columns a summary carries). */
export function toSession(summary: SessionSummary): Session {
  return SessionSchema.parse(summary);
}

/**
 * architecture/backtest-app-system-design.md §7.2 — backtest session CRUD. Every call is scoped
 * to `userId` (the cookie user); another user's session is a 404, never a 403 (§7). With no
 * `DATABASE_URL`, every method answers 503 (§2.2).
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(BACKTEST_REPOSITORIES) private readonly repos: BacktestRepositories | null,
    private readonly config: AppConfigService,
    @Inject(CANDLE_STORE) private readonly store: CandleStore,
  ) {}

  /**
   * Takes the raw body: the two layout codes have to be checked before the contract schema,
   * which would otherwise reject the same input as a generic 400 (see `checkLayoutPanels`).
   */
  async create(userId: string, body: unknown): Promise<Session> {
    const repos = this.requireEnabled();

    const layoutError = checkLayoutPanels(body);
    if (layoutError) throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, layoutError.code, layoutError.message);

    const parsed = CreateSessionRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const req = parsed.data;
    const periodError = periodShapeError(req);
    if (periodError) throw new BadRequestException(periodError);

    const sessionCurrencyOf = new Map<InstrumentId, string>(this.config.instruments.map((i) => [i.id, i.sessionCurrency]));
    const panelInstruments = [...new Set(req.layout.panels.map((p) => p.instrument))].filter((id) => sessionCurrencyOf.has(id));
    const coverageOf = new Map<InstrumentId, Coverage | null>(
      await Promise.all(panelInstruments.map(async (id) => [id, await this.store.coverage(id, '1m')] as const)),
    );

    const verdict = validateCreateSession(req, sessionCurrencyOf, coverageOf);
    if (isValidationError(verdict)) throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, verdict.code, verdict.message);

    const created = await repos.sessions.insert(userId, {
      name: req.name,
      sessionCurrency: verdict.sessionCurrency,
      timeframe: req.timeframe,
      periodFromMs: req.periodFromMs,
      periodToMs: req.periodToMs,
      initialBalance: req.initialBalance,
      defaultRiskPct: req.defaultRiskPct,
      costs: req.costs,
      skipWeekends: req.skipWeekends ?? DEFAULT_SKIP_WEEKENDS,
      notionalWarnMultiple: req.notionalWarnMultiple ?? DEFAULT_NOTIONAL_WARN_MULTIPLE,
      layout: req.layout,
    });
    return toSession(created);
  }

  async list(userId: string): Promise<SessionSummary[]> {
    return this.requireEnabled().sessions.listByUser(userId);
  }

  /** The stored row (config + aggregates); 404 when absent or owned by someone else. */
  async get(userId: string, id: string): Promise<SessionSummary> {
    const repos = this.requireEnabled();
    const session = UuidSchema.safeParse(id).success ? await repos.sessions.findById(userId, id) : null;
    if (!session) throw notFound();
    return session;
  }

  /**
   * §7.2 GET /backtest/sessions/:id. `stats` is recomputed from the session's closed orders with
   * replay-core's `computeStats` (decision 38: the list reads the stored aggregates, the detail
   * recomputes). The orders are read only after the session has resolved for this user.
   * `openOrders` is empty until order persistence lands (T-015).
   */
  async detail(userId: string, id: string): Promise<SessionDetail> {
    const session = await this.get(userId, id);
    const closed = await this.requireEnabled().orders.listClosedForStats(session.id);
    return {
      session: toSession(session),
      openOrders: [],
      stats: computeStats(closed, session.initialBalance, session.periodFromMs),
    };
  }

  /**
   * `{name?, timeframe?}` only — a layout edit is T-029 and is refused here rather than silently
   * dropped. Changing the timeframe of a complete session is 409 `SESSION_COMPLETE` (the client
   * may still switch tf locally in view-only mode, §7.2); renaming it is allowed. The row is
   * locked while the status is checked, so a concurrent completion cannot slip between the two.
   */
  async patch(userId: string, id: string, patch: PatchSessionRequest): Promise<Session> {
    const repos = this.requireEnabled();
    if (patch.layout !== undefined) {
      throw new BadRequestException('Editing the layout of a session is not supported yet.');
    }
    if (!UuidSchema.safeParse(id).success) throw notFound();

    const updated = await repos.transaction(async (tx) => {
      const current = await tx.sessions.findById(userId, id, { forUpdate: true });
      if (!current) throw notFound();
      if (patch.timeframe !== undefined && current.status === 'complete') {
        throw apiError(HttpStatus.CONFLICT, 'SESSION_COMPLETE', 'The timeframe of a complete session cannot be changed.');
      }
      return tx.sessions.update(userId, id, { name: patch.name, timeframe: patch.timeframe });
    });
    if (!updated) throw notFound();
    return toSession(updated);
  }

  /** Row delete; orders, modifications, screenshot rows and ops cascade (§3). */
  async delete(userId: string, id: string): Promise<void> {
    const repos = this.requireEnabled();
    const deleted = UuidSchema.safeParse(id).success && (await repos.sessions.delete(userId, id));
    if (!deleted) throw notFound();
  }

  /** 503 when the DB module is disabled. */
  assertEnabled(): void {
    this.requireEnabled();
  }

  private requireEnabled(): BacktestRepositories {
    if (!this.repos) throw new ServiceUnavailableException('backtest disabled: DATABASE_URL not set');
    return this.repos;
  }
}

function notFound(): NotFoundException {
  return new NotFoundException('Session not found.');
}
