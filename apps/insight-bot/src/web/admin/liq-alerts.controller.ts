import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Patch, ServiceUnavailableException } from '@nestjs/common';
import { WebLiqAlertSettingsPatchSchema, type WebLiqAlertsAdminResponse } from '@trade-automation/contracts';
import { LiqAlertsAdmin, LiqAlertsAdminNotListed } from '../../alerts/liquidations/liq-alerts-admin';
import type { User } from '../../users/user.model';
import { AdminOnly, CurrentUser } from '../auth/web-auth.guard';

export const LIQ_ALERTS_ADMIN = Symbol('LIQ_ALERTS_ADMIN');

/**
 * IB-122 (liq design §1, L4) — `/api/web/admin/alerts/liq`: the large-liquidation section of the alerts
 * page. Admin only. The body is parsed by the contract's strict schema (anything else is 400); a coin
 * that is not on the alert list is 404. Both routes answer with the whole section.
 */
@AdminOnly()
@Controller('api/web/admin/alerts/liq')
export class WebLiqAlertsAdminController {
  constructor(@Inject(LIQ_ALERTS_ADMIN) private readonly maybeAdmin: LiqAlertsAdmin | null) {}

  private get admin(): LiqAlertsAdmin {
    if (!this.maybeAdmin) throw new ServiceUnavailableException({ code: 'NO_DATABASE', message: 'alerts need the database' });
    return this.maybeAdmin;
  }

  @Get()
  page(): Promise<WebLiqAlertsAdminResponse> {
    return this.admin.page();
  }

  @Patch()
  async patch(@CurrentUser() user: User, @Body() body: unknown): Promise<WebLiqAlertsAdminResponse> {
    const parsed = WebLiqAlertSettingsPatchSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException({ code: 'INVALID_SETTINGS', message: parsed.error.issues[0]?.message ?? 'invalid' });
    try {
      return await this.admin.patch(parsed.data, user.id);
    } catch (error) {
      if (error instanceof LiqAlertsAdminNotListed) throw new NotFoundException({ code: 'NOT_FOUND', message: error.message });
      throw error;
    }
  }
}
