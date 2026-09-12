import { Controller, Get } from '@nestjs/common';
import { LayoutsResponse } from '@trade-automation/contracts';
import { AppConfigService } from '../../config/config.service';

/** architecture/chart-layouts.md §2.3 — GET /api/layouts. */
@Controller('api/layouts')
export class LayoutsController {
  constructor(private readonly config: AppConfigService) {}

  @Get()
  list(): LayoutsResponse {
    return this.config.layouts;
  }
}
