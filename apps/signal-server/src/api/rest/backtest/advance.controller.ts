import { Body, Controller, HttpCode, HttpStatus, Param, Post, UnauthorizedException } from '@nestjs/common';
import { AdvanceRequest, AdvanceRequestSchema, AdvanceResult, User } from '@trade-automation/contracts';
import { CurrentUser } from '../../../auth/current-user.decorator';
import { AdvanceService } from '../../../backtest/advance.service';
import { ZodValidationPipe } from '../../zod-validation.pipe';

/**
 * architecture/backtest-app-system-design.md §7.2, §5.5 — POST /api/backtest/sessions/:id/advance.
 * Authenticated by the global AuthGuard; scoped to the cookie user. A replayed `opId` (D9) answers
 * 200 with the stored body.
 */
@Controller('api/backtest/sessions/:id/advance')
export class AdvanceController {
  constructor(private readonly advancer: AdvanceService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  advance(
    @CurrentUser() user: User | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdvanceRequestSchema)) body: AdvanceRequest,
  ): Promise<AdvanceResult> {
    this.advancer.assertEnabled();
    if (!user) throw new UnauthorizedException('authentication required');
    return this.advancer.advance(user.id, id, body);
  }
}
