import type { WebFeatureKey, WebFeatureValue } from '@trade-automation/contracts';
import { cvdFeatures } from './calculators/cvd';
import { emaFeatures } from './calculators/ema';
import { fundingFeatures } from './calculators/funding';
import { labelFeatures } from './calculators/label-p4';
import { liquidationFeatures } from './calculators/liquidations';
import { longShortFeatures } from './calculators/long-short';
import { openInterestFeatures } from './calculators/open-interest';
import { priceFeatures } from './calculators/price';
import { structureFeatures } from './calculators/structure';
import { volatilityFeatures } from './calculators/volatility';
import type { Gathered } from './gather';

/**
 * IB-015 — every §8.2 key computed from one gathered bundle. Pure.
 *
 * **Order matters here and nowhere else in the pass.** Three keys are built from other keys'
 * outputs rather than from the database:
 *
 * - `structure.failed_highs_24h` measures its threshold in units of the 1 h ATR;
 * - `label.p4` (design §9.2) is a function of the 4 h return, the 4 h ATR and the two CVDs.
 *
 * They read the COMPUTED values, never a second recomputation of them. A second computation is
 * a second chance to disagree: if `label.p4` recalculated the 4 h return from the bars, a bug in
 * one path would produce a frame whose label contradicts its own `px.ret_4h`, and both would
 * look authoritative.
 */

/** The number a key resolved to, or null when it refused. Refusals propagate as null. */
function numberOf(
  computed: Partial<Record<WebFeatureKey, WebFeatureValue>>,
  key: WebFeatureKey,
): number | null {
  const value = computed[key];
  if (value === undefined || !value.ok) return null;
  return typeof value.value === 'number' ? value.value : null;
}

export function computeAll(gathered: Gathered): Partial<Record<WebFeatureKey, WebFeatureValue>> {
  const computed: Partial<Record<WebFeatureKey, WebFeatureValue>> = {};

  const merge = (part: Partial<Record<WebFeatureKey, WebFeatureValue>>) => Object.assign(computed, part);

  // 1. Volatility first: structure and the label both measure against an ATR.
  merge(volatilityFeatures(gathered.volatility));

  // 2. Structure, with the 1 h ATR it just produced. A refusal stays a refusal: `atr1h: null`
  //    makes `failed_highs_24h` refuse rather than fall back to a fixed threshold, because a
  //    threshold in price units means something different on every symbol.
  merge(structureFeatures({ ...gathered.structure, atr1h: numberOf(computed, 'atr.1h.14') }));

  // 3. Everything read straight from the database.
  merge(priceFeatures(gathered.price));
  merge(emaFeatures(gathered.ema));
  merge(cvdFeatures(gathered.cvd));
  merge(fundingFeatures(gathered.funding));
  merge(openInterestFeatures(gathered.oi));
  merge(longShortFeatures(gathered.ls));
  merge(liquidationFeatures(gathered.liq));

  // 4. The label, from the frame's own answers.
  merge(labelFeatures({
    ret4hPct: numberOf(computed, 'px.ret_4h'),
    atr4h: numberOf(computed, 'atr.4h.14'),
    close: gathered.price.close,
    cvdSpot4h: numberOf(computed, 'cvd.spot.4h'),
    cvdPerp4h: numberOf(computed, 'cvd.perp.4h'),
  }));

  return computed;
}
