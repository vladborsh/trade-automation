import { Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Post } from '@nestjs/common';
import type { WebInviteResponse, WebMember, WebMemberResponse, WebMembersResponse } from '@trade-automation/contracts';
import { AppConfigService } from '../../config/config.service';
import { inviteLink } from '../../users/invite-code';
import type { User } from '../../users/user.model';
import { UsersService } from '../../users/users.service';
import { AdminOnly, CurrentUser } from '../auth/web-auth.guard';

type MemberRow = Awaited<ReturnType<UsersService['listMembers']>>[number];

export const toWebMember = (m: MemberRow): WebMember => ({
  id: m.id, tgUserId: m.tgUserId, login: m.login, role: m.role, disabled: m.disabled,
  createdAt: m.createdAt.getTime(), lastLoginAt: m.lastLoginAt?.getTime() ?? null, activeSessions: m.activeSessions,
});

/**
 * IB-035 — the admin's members page. **Admin-only as a whole controller** (IB-075's rule): a member
 * gets 403. Every action goes through `UsersService`, the same one the bot's `/users` and `/invite` use.
 */
@AdminOnly()
@Controller('api/web/admin')
export class WebMembersController {
  constructor(
    private readonly users: UsersService,
    private readonly config: AppConfigService,
  ) {}

  @Get('members')
  async members(): Promise<WebMembersResponse> {
    return { members: (await this.users.listMembers()).map(toWebMember) };
  }

  /** The link is in this answer only; the list never carries invite codes. */
  @Post('invites')
  @HttpCode(201)
  async invite(@CurrentUser() admin: User, @Body() _body: unknown): Promise<WebInviteResponse> {
    const bot = this.config.env.get('TELEGRAM_BOT_USERNAME');
    if (!bot) throw new ConflictException({ code: 'BOT_NOT_CONFIGURED' });
    const invite = await this.users.issueInvite(admin.id);
    return { link: inviteLink(bot, invite.code), expiresAt: invite.expiresAt.getTime() };
  }

  @Post('members/:id/disable')
  @HttpCode(200)
  async disable(@CurrentUser() admin: User, @Param('id', ParseIntPipe) id: number): Promise<WebMemberResponse> {
    return this.set(admin, id, true);
  }

  @Post('members/:id/enable')
  @HttpCode(200)
  async enable(@CurrentUser() admin: User, @Param('id', ParseIntPipe) id: number): Promise<WebMemberResponse> {
    return this.set(admin, id, false);
  }

  private async set(admin: User, id: number, disabled: boolean): Promise<WebMemberResponse> {
    const result = await this.users.setDisabled(admin, id, disabled);
    if (!result.ok) {
      if (result.reason === 'NOT_FOUND') throw new NotFoundException({ code: 'NOT_FOUND' });
      throw new ConflictException({ code: result.reason });
    }
    const row = (await this.users.listMembers()).find((m) => m.id === id);
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND' });
    return { member: toWebMember(row) };
  }
}
