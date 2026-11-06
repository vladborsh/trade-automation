import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Optional, Patch } from '@nestjs/common';
import { WebMemberSettingsPatchSchema, type WebMemberSettings } from '@trade-automation/contracts';
import { oiAlertsVisible, settingsPatchFromWeb } from '../../users/members';
import type { User } from '../../users/user.model';
import { UsersService } from '../../users/users.service';
import { CurrentUser } from '../auth/web-auth.guard';

/** IB-112: reads `alert_settings.members_visible`. Absent (no DB in a spec) → hidden from members. */
export const OI_ALERTS_VISIBILITY = Symbol('OI_ALERTS_VISIBILITY');
export interface OiAlertsVisibility {
  membersVisible(): Promise<boolean>;
}
/** IB-122: reads `alert_type_settings('liq').members_visible`, the same way. */
export const LIQ_ALERTS_VISIBILITY = Symbol('LIQ_ALERTS_VISIBILITY');
/** IB-124: reads `alert_type_settings('funding').members_visible`, the same way. */
export const FUNDING_ALERTS_VISIBILITY = Symbol('FUNDING_ALERTS_VISIBILITY');

/**
 * IB-035 — a member's own settings on the site: exactly the bot's `/lang`, `/calendar` and (IB-112)
 * `/oialerts`, through the same parsers (`settingsPatchFromWeb`) and the same
 * `UsersService.updateSettings`. Changing the language here changes the bot's answers too: it is one
 * column. The OI alerts toggle is shown to a member only while the admin page's `members_visible` is
 * on (an admin always sees it); changing it while hidden is refused, not ignored.
 */
interface Visible { oi: boolean; liq: boolean; funding: boolean }

@Controller('api/web/me')
export class WebMeSettingsController {
  constructor(
    private readonly users: UsersService,
    @Optional() @Inject(OI_ALERTS_VISIBILITY) private readonly oiVisibility?: OiAlertsVisibility,
    @Optional() @Inject(LIQ_ALERTS_VISIBILITY) private readonly liqVisibility?: OiAlertsVisibility,
    @Optional() @Inject(FUNDING_ALERTS_VISIBILITY) private readonly fundingVisibility?: OiAlertsVisibility,
  ) {}

  /** Who sees each hidden-by-default toggle: an admin always, a member while that type's `members_visible` is on. */
  private async visible(user: User): Promise<Visible> {
    return {
      oi: oiAlertsVisible(user, (await this.oiVisibility?.membersVisible()) ?? false),
      liq: oiAlertsVisible(user, (await this.liqVisibility?.membersVisible()) ?? false),
      funding: oiAlertsVisible(user, (await this.fundingVisibility?.membersVisible()) ?? false),
    };
  }

  private view(u: User, visible: Visible): WebMemberSettings {
    return {
      lang: u.lang, calendarAlerts: u.calendarAlerts, oiAlerts: u.oiAlerts, oiAlertsVisible: visible.oi, liqAlerts: u.liqAlerts, liqAlertsVisible: visible.liq,
      fundingAlerts: u.fundingAlerts, fundingAlertsVisible: visible.funding,
    };
  }

  @Get('settings')
  async settings(@CurrentUser() user: User): Promise<WebMemberSettings> {
    return this.view(user, await this.visible(user));
  }

  @Patch('settings')
  async update(@CurrentUser() user: User, @Body() body: unknown): Promise<WebMemberSettings> {
    const shape = WebMemberSettingsPatchSchema.safeParse(body ?? {});
    // strict: a field the site has no setting for (deposit, riskPct…) is refused, never ignored
    if (!shape.success) throw new BadRequestException({ code: 'INVALID_SETTING', field: null });
    const visible = await this.visible(user);
    if (shape.data.oiAlerts !== undefined && !visible.oi) throw new ForbiddenException({ code: 'SETTING_NOT_AVAILABLE', field: 'oiAlerts' });
    if (shape.data.liqAlerts !== undefined && !visible.liq) throw new ForbiddenException({ code: 'SETTING_NOT_AVAILABLE', field: 'liqAlerts' });
    if (shape.data.fundingAlerts !== undefined && !visible.funding) throw new ForbiddenException({ code: 'SETTING_NOT_AVAILABLE', field: 'fundingAlerts' });
    const parsed = settingsPatchFromWeb(shape.data);
    if (!parsed.ok) throw new BadRequestException({ code: 'INVALID_SETTING', field: parsed.field });
    const updated = Object.keys(parsed.patch).length > 0 ? await this.users.updateSettings(user.id, parsed.patch) : user;
    return this.view(updated ?? user, visible);
  }
}
