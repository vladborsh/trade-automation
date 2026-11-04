import { BadRequestException, Body, Controller, Get, Patch } from '@nestjs/common';
import { WebMemberSettingsPatchSchema, type WebMemberSettings } from '@trade-automation/contracts';
import { settingsPatchFromWeb } from '../../users/members';
import type { User } from '../../users/user.model';
import { UsersService } from '../../users/users.service';
import { CurrentUser } from '../auth/web-auth.guard';

/**
 * IB-035 — a member's own settings on the site: exactly the bot's `/lang` and `/calendar`, through
 * the same parsers (`settingsPatchFromWeb`) and the same `UsersService.updateSettings`. Changing the
 * language here changes the bot's answers too: it is one column.
 */
@Controller('api/web/me')
export class WebMeSettingsController {
  constructor(private readonly users: UsersService) {}

  @Get('settings')
  settings(@CurrentUser() user: User): WebMemberSettings {
    return { lang: user.lang, calendarAlerts: user.calendarAlerts };
  }

  @Patch('settings')
  async update(@CurrentUser() user: User, @Body() body: unknown): Promise<WebMemberSettings> {
    const shape = WebMemberSettingsPatchSchema.safeParse(body ?? {});
    // strict: a field the site has no setting for (deposit, riskPct…) is refused, never ignored
    if (!shape.success) throw new BadRequestException({ code: 'INVALID_SETTING', field: null });
    const parsed = settingsPatchFromWeb(shape.data);
    if (!parsed.ok) throw new BadRequestException({ code: 'INVALID_SETTING', field: parsed.field });
    const updated = Object.keys(parsed.patch).length > 0 ? await this.users.updateSettings(user.id, parsed.patch) : user;
    const u = updated ?? user;
    return { lang: u.lang, calendarAlerts: u.calendarAlerts };
  }
}
