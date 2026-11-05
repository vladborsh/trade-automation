import type { OiDivergenceParams, OiDivergenceTf } from '@trade-automation/contracts';
import type { DivergenceParams } from './detector';

/**
 * The admin's params (one row, `OiDivergenceParams`) as the detector takes them for one TF. The alert loop and
 * the chart endpoint both build them here, so a key added to the contract (IB-114's line tolerances) cannot reach
 * one caller and not the other.
 */
export function detectorParams(p: OiDivergenceParams, tf: OiDivergenceTf): DivergenceParams {
  const { sendHidden: _sending, ...reach } = p.perTf[tf]; // IB-144: a delivery switch, not a detector param
  return {
    ...reach,
    atrMult: p.atrMult,
    oiMedianMult: p.oiMedianMult,
    priceLineTolAtrMult: p.priceLineTolAtrMult,
    oiLineTolMedianMult: p.oiLineTolMedianMult,
  };
}
