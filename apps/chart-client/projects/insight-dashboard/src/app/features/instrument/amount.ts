import { Pipe, type PipeTransform } from '@angular/core';

/**
 * IB-BUG-024 — a venue's price or quantity as it was, without the float noise a sum or a
 * conversion leaves behind: OKX quantities arrive as contracts × face value, and 140.065 came out
 * as «140.06500000000003» in «50 крупнейших ликвидаций». Rounded to AMOUNT_DIGITS significant
 * digits — far more than any venue quotes, far fewer than the noise sits at — then printed
 * without trailing zeros. Never `toFixed`, which would invent or drop real decimals.
 */
export const AMOUNT_DIGITS = 10;

export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return String(Number(value.toPrecision(AMOUNT_DIGITS)));
}

@Pipe({ name: 'amount', standalone: true, pure: true })
export class AmountPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatAmount(value);
  }
}
