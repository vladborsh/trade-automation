import { HttpException } from '@nestjs/common';
import { BacktestErrorCode, ErrorResponse } from '@trade-automation/contracts';

/**
 * architecture/backtest-app-system-design.md §7 — errors are `{ error: { code, message } }` with
 * the codes named in the note (`ErrorResponseSchema` in `libs/contracts/src/backtest.ts`).
 */
export function apiError(status: number, code: BacktestErrorCode, message: string): HttpException {
  const body: ErrorResponse = { error: { code, message } };
  return new HttpException(body, status);
}
