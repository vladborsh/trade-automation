import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  WebCustomLevelCreateSchema, WebCustomLevelPatchSchema, type WebCustomLevelsResponse,
} from '@trade-automation/contracts';
import { CustomLevelError, CustomLevels } from '../../alerts/levels/custom-levels';
import type { User } from '../../users/user.model';
import { AdminOnly, CurrentUser } from '../auth/web-auth.guard';

export const CUSTOM_LEVELS = Symbol('CUSTOM_LEVELS');

/**
 * IB-128 (design §4 P9) — `/api/web/admin/alerts/levels/custom`: the owner's levels on the «Levels» section. Admin
 * only. Bodies are parsed by the contracts' strict schemas (anything else is 400). A coin not on the alert list or an
 * id with no active level is 404; a coin at its level cap is 409. Every route answers with the active list.
 */
@AdminOnly()
@Controller('api/web/admin/alerts/levels/custom')
export class WebCustomLevelsAdminController {
  constructor(@Inject(CUSTOM_LEVELS) private readonly maybeLevels: CustomLevels | null) {}

  private get levels(): CustomLevels {
    if (!this.maybeLevels) throw new ServiceUnavailableException({ code: 'NO_DATABASE', message: 'custom levels need the database' });
    return this.maybeLevels;
  }

  @Get()
  list(): Promise<WebCustomLevelsResponse> {
    return this.levels.list();
  }

  @Post()
  @HttpCode(200)
  async add(@CurrentUser() user: User, @Body() body: unknown): Promise<WebCustomLevelsResponse> {
    const parsed = WebCustomLevelCreateSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException({ code: 'INVALID_LEVEL', message: parsed.error.issues[0]?.message ?? 'invalid' });
    await mapped(() => this.levels.add(parsed.data, user.id));
    return this.levels.list();
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() body: unknown): Promise<WebCustomLevelsResponse> {
    const parsed = WebCustomLevelPatchSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException({ code: 'INVALID_LEVEL', message: parsed.error.issues[0]?.message ?? 'invalid' });
    await mapped(() => this.levels.setEvents(idOf(id), parsed.data.events));
    return this.levels.list();
  }

  @Delete(':id')
  async remove(@CurrentUser() user: User, @Param('id') id: string): Promise<WebCustomLevelsResponse> {
    await mapped(() => this.levels.remove(idOf(id), user.id));
    return this.levels.list();
  }
}

function idOf(text: string): number {
  if (!/^\d{1,15}$/.test(text) || Number(text) < 1) throw new BadRequestException({ code: 'INVALID_LEVEL', message: 'bad id' });
  return Number(text);
}

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof CustomLevelError) {
      if (error.reason === 'too_many') throw new ConflictException({ code: 'TOO_MANY_LEVELS', message: error.message });
      throw new NotFoundException({ code: 'NOT_FOUND', message: error.message });
    }
    throw error;
  }
}
