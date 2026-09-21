import { Controller, Get, HttpCode, HttpStatus, Param, Put, Req, Res, StreamableFile, UnauthorizedException } from '@nestjs/common';
import type { ScreenshotUploadResponse, User } from '@trade-automation/contracts';
import type { IncomingMessage } from 'http';
import { AuthHttpResponse } from '../../../auth/auth-request';
import { CurrentUser } from '../../../auth/current-user.decorator';
import { ScreenshotService } from '../../../backtest/screenshot.service';

/**
 * architecture/backtest-app-system-design.md §7.2, §9.2 —
 * PUT/GET /api/backtest/sessions/:id/orders/:orderId/screenshots/:kind. Authenticated by the
 * global AuthGuard and scoped to the cookie user. PUT takes the raw `image/png` body (≤ 2 MB,
 * written once); GET proxies the bytes from the private store with a long private cache.
 */
@Controller('api/backtest/sessions/:id/orders/:orderId/screenshots/:kind')
export class ScreenshotsController {
  constructor(private readonly screenshots: ScreenshotService) {}

  @Put()
  @HttpCode(HttpStatus.CREATED)
  put(
    @CurrentUser() user: User | undefined,
    @Param('id') id: string,
    @Param('orderId') orderId: string,
    @Param('kind') kind: string,
    @Req() req: IncomingMessage,
  ): Promise<ScreenshotUploadResponse> {
    return this.screenshots.put(this.ownerId(user), id, orderId, kind, {
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      body: req,
    });
  }

  @Get()
  async get(
    @CurrentUser() user: User | undefined,
    @Param('id') id: string,
    @Param('orderId') orderId: string,
    @Param('kind') kind: string,
    @Res({ passthrough: true }) res: AuthHttpResponse,
  ): Promise<StreamableFile> {
    const bytes = await this.screenshots.get(this.ownerId(user), id, orderId, kind);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=31536000');
    return new StreamableFile(bytes, { type: 'image/png', length: bytes.length });
  }

  /** 503 without a DB (the guard is then a pass-through and there is no user); otherwise the cookie user. */
  private ownerId(user: User | undefined): string {
    this.screenshots.assertEnabled();
    if (!user) throw new UnauthorizedException('authentication required');
    return user.id;
  }
}
