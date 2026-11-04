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

/**
 * IB-035 — a member's own settings on the site: exactly the bot's `/lang`, `/calendar` and (IB-112)
 * `/oialerts`, through the same parsers (`settingsPatchFromWeb`) and the same
 * `UsersService.updateSettings`. Changing the language here changes the bot's answers too: it is one
 * column. The OI alerts toggle is shown to a member only while the admin page's `members_visible` is
 * on (an admin always sees it); changing it while hidden is refused, not ignored.
 */
@Controller('api/web/me')
export class WebMeSettingsController {
  constructor(
    private readonly users: UsersService,
    @Optional() @Inject(OI_ALERTS_VISIBILITY) private readonly oiVisibility?: OiAlertsVisibility,
  ) {}

  private async visible(user: User): Promise<boolean> {
    return oiAlertsVisible(user, (await this.oiVisibility?.membersVisible()) ?? false);
  }

  private view(u: User, visible: boolean): WebMemberSettings {
    return { lang: u.lang, calendarAlerts: u.calendarAlerts, oiAlerts: u.oiAlerts, oiAlertsVisible: visible };
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
    if (shape.data.oiAlerts !== undefined && !visible) throw new ForbiddenException({ code: 'SETTING_NOT_AVAILABLE', field: 'oiAlerts' });
    const parsed = settingsPatchFromWeb(shape.data);
    if (!parsed.ok) throw new BadRequestException({ code: 'INVALID_SETTING', field: parsed.field });
    const updated = Object.keys(parsed.patch).length > 0 ? await this.users.updateSettings(user.id, parsed.patch) : user;
    return this.view(updated ?? user, visible);
  }
}
