import { Controller, Get, Query } from '@nestjs/common';
import type { WebLoginEventsResponse } from '@trade-automation/contracts';
import { AdminOnly } from '../auth/web-auth.guard';
import { CredentialsService } from '../auth/credentials.service';

/**
 * IB-078 P10 — the login journal, newest first. **Admin-only as a whole controller**: a
 * `login_attempted` value can be a password someone typed into the login box.
 */
@AdminOnly()
@Controller('api/web/admin')
export class WebAdminController {
  constructor(private readonly credentials: CredentialsService) {}

  @Get('login-events')
  async loginEvents(@Query('limit') limit?: string): Promise<WebLoginEventsResponse> {
    const n = Number(limit ?? 100);
    const events = await this.credentials.loginEvents(Number.isFinite(n) ? n : 100);
    return {
      events: events.map((e) => ({
        id: e.id, at: e.at.getTime(), userId: e.userId, loginAttempted: e.loginAttempted,
        outcome: e.outcome, ip: e.ip, userAgent: e.userAgent,
      })),
    };
  }
}
