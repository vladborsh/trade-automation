import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Patch, ServiceUnavailableException } from '@nestjs/common';
import { WebLevelAlertSettingsPatchSchema, type WebLevelAlertsAdminResponse } from '@trade-automation/contracts';
import { LevelAlertsAdmin, LevelAlertsAdminNotListed } from '../../alerts/levels/level-alerts-admin';
import type { User } from '../../users/user.model';
import { AdminOnly, CurrentUser } from '../auth/web-auth.guard';

export const LEVEL_ALERTS_ADMIN = Symbol('LEVEL_ALERTS_ADMIN');

/**
 * IB-126 (design §1, P2) — `/api/web/admin/alerts/levels`: the levels section of the alerts page. Admin only. The body
 * is parsed by the contract's strict schema (anything else, or an event that does not apply to its kind, is 400); a
 * coin that is not on the alert list is 404. Both routes answer with the whole section.
 */
@AdminOnly()
@Controller('api/web/admin/alerts/levels')
export class WebLevelAlertsAdminController {
  constructor(@Inject(LEVEL_ALERTS_ADMIN) private readonly maybeAdmin: LevelAlertsAdmin | null) {}

  private get admin(): LevelAlertsAdmin {
    if (!this.maybeAdmin) throw new ServiceUnavailableException({ code: 'NO_DATABASE', message: 'alerts need the database' });
    return this.maybeAdmin;
  }

  @Get()
  page(): Promise<WebLevelAlertsAdminResponse> {
    return this.admin.page();
  }

  @Patch()
  async patch(@CurrentUser() user: User, @Body() body: unknown): Promise<WebLevelAlertsAdminResponse> {
    const parsed = WebLevelAlertSettingsPatchSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException({ code: 'INVALID_SETTINGS', message: parsed.error.issues[0]?.message ?? 'invalid' });
    try {
      return await this.admin.patch(parsed.data, user.id);
    } catch (error) {
      if (error instanceof LevelAlertsAdminNotListed) throw new NotFoundException({ code: 'NOT_FOUND', message: error.message });
      throw error;
    }
  }
}
