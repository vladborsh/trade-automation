import { MetricObservation } from '@trade-automation/contracts';

/**
 * architecture/chart-layouts.md §11.1 "Legacy stored rows" — rows written before the unit tag
 * carry neither `unit` nor `notionalBasis`. Pure; run on every store read (file and S3), so
 * no file rewrite and no migration job:
 * - missing `unit` → 'base': every pre-tag row came from the USDⓈ-M mapper, which only ever
 *   wrote base-asset units.
 * - `notional` present without `notionalBasis` → 'venue': only history rows
 *   (`sumOpenInterestValue`) ever had a notional.
 * Fields already present are kept as is.
 */
export function upgradeLegacyObservation(raw: unknown): MetricObservation {
  const o = raw as Partial<MetricObservation> & Omit<MetricObservation, 'unit'>;
  const upgraded: MetricObservation = { ...o, unit: o.unit ?? 'base' };
  if (upgraded.notional !== undefined && upgraded.notionalBasis === undefined) {
    upgraded.notionalBasis = 'venue';
  }
  return upgraded;
}
