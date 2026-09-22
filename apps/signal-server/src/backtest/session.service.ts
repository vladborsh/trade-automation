import {
  BadRequestException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Coverage,
  CreateSessionRequestSchema,
  InstrumentId,
  PatchSessionRequestSchema,
  Session,
  SessionDetail,
  SessionLayout,
  SessionSchema,
  SessionSummary,
} from '@trade-automation/contracts';
import { computeStats } from '@trade-automation/replay-core';
import { z } from 'zod';
import { apiError } from '../auth/auth-error';
import { AppConfigService } from '../config/config.service';
import { CANDLE_STORE, CandleStore } from '../storage/candle-store.port';
import { SCREENSHOT_STORE, ScreenshotStore, sessionScreenshotPrefix } from '../storage/screenshot-store.port';
import { BACKTEST_REPOSITORIES, BacktestRepositories } from './session.repository.port';
import { checkLayoutPanels, isValidationError, panelsLosingActiveOrders, periodShapeError, validateCreateSession, validateLayoutEdit } from './session-validation';

/** §7.2 default: `skipWeekends` true (§13, decision 19). */
export const DEFAULT_SKIP_WEEKENDS = true;

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
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @Inject(BACKTEST_REPOSITORIES) private readonly repos: BacktestRepositories | null,
    private readonly config: AppConfigService,
    @Inject(CANDLE_STORE) private readonly store: CandleStore,
    @Inject(SCREENSHOT_STORE) private readonly screenshots: ScreenshotStore,
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

    const verdict = validateCreateSession(req, sessionCurrencyOf, coverageOf, this.instrumentsWithContract());
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
   * recomputes). `openOrders` are the pending and open orders, by `seq`. The orders are read only
   * after the session has resolved for this user.
   */
  async detail(userId: string, id: string): Promise<SessionDetail> {
    const session = await this.get(userId, id);
    const { orders } = this.requireEnabled();
    const closed = await orders.listClosedForStats(session.id);
    return {
      session: toSession(session),
      openOrders: await orders.list(session.id, ['pending', 'open']),
      stats: computeStats(closed, session.initialBalance, session.periodFromMs),
    };
  }

  /**
   * §7.2 PATCH: `{name?, timeframe?, layout?}`. Takes the raw body, like create, so the two layout
   * codes are reachable (see `checkLayoutPanels`).
   *
   * A layout edit (T-029) passes the create checks against the session's own period, may not
   * change the session's currency (`validateLayoutEdit`, 422 codes as create), and may not take a
   * panel away from a pending or open order (plain 409; the orders carry `panel_id`). Changing the
   * timeframe or the layout of a complete session is 409 `SESSION_COMPLETE`; renaming it is fine.
   * The row is locked while the status and the orders are checked, so a concurrent completion or
   * order placement cannot slip in between. A layout edit never touches the cursor.
   */
  async patch(userId: string, id: string, body: unknown): Promise<Session> {
    const repos = this.requireEnabled();
    const layoutError = checkLayoutPanels(body);
    if (layoutError) throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, layoutError.code, layoutError.message);
    const parsed = PatchSessionRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const patch = parsed.data;
    if (!UuidSchema.safeParse(id).success) throw notFound();

    if (patch.layout) {
      const session = await repos.sessions.findById(userId, id);
      if (!session) throw notFound();
      const error = validateLayoutEdit(patch.layout, session, ...(await this.catalogueFor(patch.layout)));
      if (error) throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, error.code, error.message);
    }

    const updated = await repos.transaction(async (tx) => {
      const current = await tx.sessions.findById(userId, id, { forUpdate: true });
      if (!current) throw notFound();
      if ((patch.timeframe !== undefined || patch.layout !== undefined) && current.status === 'complete') {
        throw apiError(HttpStatus.CONFLICT, 'SESSION_COMPLETE', 'The timeframe or layout of a complete session cannot be changed.');
      }
      if (patch.layout) {
        const active = await tx.orders.list(current.id, ['pending', 'open']);
        const losing = panelsLosingActiveOrders(patch.layout, active);
        if (losing.length > 0) {
          throw apiError(HttpStatus.CONFLICT, 'PANEL_HAS_ORDERS', `Panel ${losing.map((p) => `'${p}'`).join(', ')} has pending or open orders; cancel or close them first.`);
        }
      }
      return tx.sessions.update(userId, id, { name: patch.name, timeframe: patch.timeframe, layout: patch.layout });
    });
    if (!updated) throw notFound();
    return toSession(updated);
  }

  /** D12 (T-053): the configured instruments that carry a contract block, the only ones that can be sized. */
  private instrumentsWithContract(): Set<InstrumentId> {
    return new Set(this.config.instruments.filter((i) => i.contract).map((i) => i.id));
  }

  /** The configured currencies, each panel instrument's 1m coverage and the instruments with a contract, for the layout checks. */
  private async catalogueFor(
    layout: SessionLayout,
  ): Promise<[Map<InstrumentId, string>, Map<InstrumentId, Coverage | null>, Set<InstrumentId>]> {
    const sessionCurrencyOf = new Map<InstrumentId, string>(this.config.instruments.map((i) => [i.id, i.sessionCurrency]));
    const instruments = [...new Set(layout.panels.map((p) => p.instrument))].filter((i) => sessionCurrencyOf.has(i));
    const coverageOf = new Map<InstrumentId, Coverage | null>(
      await Promise.all(instruments.map(async (i) => [i, await this.store.coverage(i, '1m')] as const)),
    );
    return [sessionCurrencyOf, coverageOf, this.instrumentsWithContract()];
  }


  /**
   * §3, decision 30b, T-025: the session's screenshot prefix is deleted from the store **first**,
   * then the row (orders, modifications, screenshot rows and ops cascade). If the store call
   * fails, the session stays and the answer is a 500, so the client can retry. If the row delete
   * then fails, what is left is rows pointing at nothing, which costs nothing.
   */
  async delete(userId: string, id: string): Promise<void> {
    const repos = this.requireEnabled();
    const session = UuidSchema.safeParse(id).success ? await repos.sessions.findById(userId, id) : null;
    if (!session) throw notFound();
    try {
      await this.screenshots.deleteByPrefix(sessionScreenshotPrefix(userId, session.id));
    } catch (err) {
      this.logger.error(`session ${session.id}: screenshot prefix delete failed, session kept: ${(err as Error).message}`);
      throw new InternalServerErrorException("Could not delete the session's screenshots; the session was kept. Try again.");
    }
    if (!(await repos.sessions.delete(userId, session.id))) throw notFound();
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
