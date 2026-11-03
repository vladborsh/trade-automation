import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DB, type Db } from '../../db/db.port';
import { sweepExpired } from './pg/auth.repo';

/** IB-BUG-017: hourly is ample — the rows only need to go, not to go at the second they expire. */
export const SESSION_SWEEP_MS = 60 * 60_000;

/**
 * IB-BUG-017 — runs `sweepExpired` (auth.repo) inside the bot: expired `web_sessions`, spent or
 * expired `web_login_tokens`, and `web_login_events` older than the 90 days the password-login
 * design promises (P10). Nothing called it before: the three tables grew without bound and the
 * journal retention was a claim, not a fact.
 *
 * The app's own periodic-job shape (the watchdog, the calendar notifier, the news reactions): an
 * interval started on bootstrap, cleared on destroy. Also **unref'd**, like IB-096's idle cache
 * sweep, so the timer never keeps a process (or a spec run) alive on its own.
 *
 * **Once at boot as well.** The box is redeployed far more often than hourly, and a timer that only
 * fires an hour after each start might never fire at all.
 *
 * A failed pass is logged at warn and the schedule carries on: a sweep that can take the process
 * down with it is worse than one that misses a turn. Passes never overlap.
 */
@Injectable()
export class SessionSweeperService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SessionSweeperService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(@Inject(DB) private readonly db: Db | null) {}

  onApplicationBootstrap(): void {
    if (!this.db) {
      this.logger.log('no database — session sweep off');
      return;
    }
    void this.sweepOnce();
    this.timer = setInterval(() => void this.sweepOnce(), SESSION_SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Public so a spec can drive it; resolves whatever happens, never rejects. */
  async sweepOnce(now = Date.now()): Promise<{ sessions: number; tokens: number; loginEvents: number } | null> {
    if (!this.db || this.running) return null;
    this.running = true;
    try {
      const swept = await sweepExpired(this.db, new Date(now));
      this.logger.debug(`swept: ${swept.sessions} sessions, ${swept.tokens} login tokens, ${swept.loginEvents} login events`);
      return swept;
    } catch (error) {
      this.logger.warn(`session sweep failed, next pass in ${SESSION_SWEEP_MS / 60_000} min — ${(error as Error).message}`);
      return null;
    } finally {
      this.running = false;
    }
  }
}
