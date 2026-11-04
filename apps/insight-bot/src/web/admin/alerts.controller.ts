import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, ServiceUnavailableException } from '@nestjs/common';
import {
  AlertSymbolSchema, WebAlertSettingsPatchSchema, WebAlertSymbolAddSchema, WebAlertSymbolPatchSchema, type WebAlertsAdminResponse,
} from '@trade-automation/contracts';
import { AlertsAdmin, AlertsAdminRefusal } from '../../alerts/oi-divergence/alerts-admin';
import type { User } from '../../users/user.model';
import { AdminOnly, CurrentUser } from '../auth/web-auth.guard';

export const ALERTS_ADMIN = Symbol('ALERTS_ADMIN');

/**
 * IB-112 (OI divergence design V17) — `/api/web/admin/alerts`: admin only as a whole controller.
 * Bodies are parsed by the contract's strict schemas (anything else is 400, never ignored); a coin
 * Binance refuses is 409 with its code; a coin not on the list is 404. Every write answers with the
 * whole page (`WebAlertsAdminResponse`).
 */
@AdminOnly()
@Controller('api/web/admin/alerts')
export class WebAlertsAdminController {
  constructor(@Inject(ALERTS_ADMIN) private readonly maybeAdmin: AlertsAdmin | null) {}

  /** No database (a bare boot): the page cannot exist, and says so rather than failing inside. */
  private get admin(): AlertsAdmin {
    if (!this.maybeAdmin) throw new ServiceUnavailableException({ code: 'NO_DATABASE', message: 'alerts need the database' });
    return this.maybeAdmin;
  }

  @Get()
  page(): Promise<WebAlertsAdminResponse> {
    return this.admin.page();
  }

  @Post('symbols')
  @HttpCode(200)
  async add(@CurrentUser() user: User, @Body() body: unknown): Promise<WebAlertsAdminResponse> {
    const parsed = WebAlertSymbolAddSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException({ code: 'INVALID_SYMBOL', message: 'symbol: a Binance USD-M symbol, upper case' });
    try {
      return await this.admin.addSymbol(parsed.data.symbol, user.id);
    } catch (error) {
      if (error instanceof AlertsAdminRefusal) throw new ConflictException({ code: error.code, message: error.code });
      throw error;
    }
  }

  @Patch('symbols/:symbol')
  async toggle(@Param('symbol') symbol: string, @Body() body: unknown): Promise<WebAlertsAdminResponse> {
    const parsed = WebAlertSymbolPatchSchema.safeParse(body ?? {});
    if (!AlertSymbolSchema.safeParse(symbol).success || !parsed.success) throw new BadRequestException({ code: 'INVALID_BODY', message: '{ enabled: boolean }' });
    const page = await this.admin.setSymbolEnabled(symbol, parsed.data.enabled);
    if (!page) throw new NotFoundException({ code: 'NOT_FOUND', message: symbol });
    return page;
  }

  @Delete('symbols/:symbol')
  async remove(@Param('symbol') symbol: string): Promise<WebAlertsAdminResponse> {
    if (!AlertSymbolSchema.safeParse(symbol).success) throw new BadRequestException({ code: 'INVALID_SYMBOL', message: symbol });
    const page = await this.admin.removeSymbol(symbol);
    if (!page) throw new NotFoundException({ code: 'NOT_FOUND', message: symbol });
    return page;
  }

  @Patch('settings')
  async settings(@CurrentUser() user: User, @Body() body: unknown): Promise<WebAlertsAdminResponse> {
    const parsed = WebAlertSettingsPatchSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException({ code: 'INVALID_SETTINGS', message: parsed.error.issues[0]?.message ?? 'invalid' });
    return this.admin.patchSettings(parsed.data, user.id);
  }
}
