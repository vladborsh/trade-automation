import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UnauthorizedException } from '@nestjs/common';
import {
  AdminInvitesResponse,
  AdminUsersResponse,
  CreateInviteRequest,
  CreateInviteRequestSchema,
  CreateInviteResponse,
  User,
} from '@trade-automation/contracts';
import { AdminOnly } from '../../auth/admin-only.decorator';
import { AdminService } from '../../auth/admin.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import { ZodValidationPipe } from '../zod-validation.pipe';

/**
 * architecture/backtest-app-system-design.md §7.1 — /api/admin/*: users and invites only
 * (decision 30). Cookie auth from the global AuthGuard, then `role='admin'` via @AdminOnly().
 */
@AdminOnly()
@Controller('api/admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  users(): Promise<AdminUsersResponse> {
    return this.admin.listUsers();
  }

  @Post('users/:id/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  disable(@CurrentUser() user: User | undefined, @Param('id') id: string): Promise<void> {
    return this.admin.disableUser(this.adminId(user), id);
  }

  @Post('users/:id/enable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async enable(@CurrentUser() user: User | undefined, @Param('id') id: string): Promise<void> {
    this.adminId(user);
    await this.admin.enableUser(id);
  }

  @Post('invites')
  createInvite(
    @CurrentUser() user: User | undefined,
    @Body(new ZodValidationPipe(CreateInviteRequestSchema)) body: CreateInviteRequest,
  ): Promise<CreateInviteResponse> {
    return this.admin.createInvite(this.adminId(user), body.email ?? null);
  }

  @Get('invites')
  invites(): Promise<AdminInvitesResponse> {
    return this.admin.listInvites();
  }

  @Delete('invites/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@Param('id') id: string): Promise<void> {
    return this.admin.revokeInvite(id);
  }

  /** 503 without a DB (both guards then pass through); otherwise the admin's own id. */
  private adminId(user: User | undefined): string {
    this.admin.assertEnabled();
    if (!user) throw new UnauthorizedException('authentication required');
    return user.id;
  }
}
