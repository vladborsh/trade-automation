import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Patch, ServiceUnavailableException } from '@nestjs/common';
import { WebFundingAlertSettingsPatchSchema, type WebFundingAlertsAdminResponse } from '@trade-automation/contracts';
import { FundingAlertsAdmin, FundingAlertsAdminNotListed } from '../../alerts/funding/funding-alerts-admin';
import type { User } from '../../users/user.model';
import { AdminOnly, CurrentUser } from '../auth/web-auth.guard';

export const FUNDING_ALERTS_ADMIN = Symbol('FUNDING_ALERTS_ADMIN');

/**
 * IB-124 (design §1, F3, F5) — `/api/web/admin/alerts/funding`: the funding section of the alerts page. Admin only. The body is parsed by the contract's strict schema (anything else is 400); a coin
 * that is not on the alert list is 404. Both routes answer with the whole section.
 */
@AdminOnly()
@Controller('api/web/admin/alerts/funding')
export class WebFundingAlertsAdminController {
  constructor(@Inject(FUNDING_ALERTS_ADMIN) private readonly maybeAdmin: FundingAlertsAdmin | null) {}

  private get admin(): FundingAlertsAdmin {
    if (!this.maybeAdmin) throw new ServiceUnavailableException({ code: 'NO_DATABASE', message: 'alerts need the database' });
    return this.maybeAdmin;
  }

  @Get()
  page(): Promise<WebFundingAlertsAdminResponse> {
    return this.admin.page();
  }

  @Patch()
  async patch(@CurrentUser() user: User, @Body() body: unknown): Promise<WebFundingAlertsAdminResponse> {
    const parsed = WebFundingAlertSettingsPatchSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException({ code: 'INVALID_SETTINGS', message: parsed.error.issues[0]?.message ?? 'invalid' });
    try {
      return await this.admin.patch(parsed.data, user.id);
    } catch (error) {
      if (error instanceof FundingAlertsAdminNotListed) throw new NotFoundException({ code: 'NOT_FOUND', message: error.message });
      throw error;
    }
  }
}
