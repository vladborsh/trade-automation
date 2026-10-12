import type { WebFeatureKey, WebFeatureValue } from '@trade-automation/contracts';

/**
 * IB-015 — `label.p4`, the spot-vs-perp label of design §9.2, pure.
 *
 * **Killed as a signal on 2026-09-28 (§16.3) and still computed.** The research found it carries
 * no information beyond the advance itself, so its score weight is 0, it may not be a
 * `context_gate`, and P3's trigger no longer references it. It survives in the frame because the
 * record is what would justify ever registering it again, and because the morning plan line and
 * the message context still read it. Computing a dead label is cheap; recreating the history
 * that would let someone re-test it is not.
 *
 * §9.2's table, exactly:
 *
 * | price | spot | perp | label |
 * |---|---|---|---|
 * | ↑ | ↑ | any | SPOT_LED |
 * | ↑ | →/↓ | ↑ | PERP_LED |
 * | ↓ | ↑ | ↓ | ABSORPTION |
 * | → | ↓ | ↑ | DISTRIBUTION |
 * | otherwise | | | NONE |
 */

export type P4Label = 'SPOT_LED' | 'PERP_LED' | 'ABSORPTION' | 'DISTRIBUTION' | 'NONE';
export type Direction = 'up' | 'down' | 'flat';

export interface LabelInput {
  /** 4 h return, percent, as `px.ret_4h` reports it. */
  ret4hPct: number | null;
  /** ATR(4h) and the price it is measured against — §9.2's threshold is 0.25·ATR/price. */
  atr4h: number | null;
  close: number | null;
  /** 4 h CVD signs. Null when the market is absent or the window refused. */
  cvdSpot4h: number | null;
  cvdPerp4h: number | null;
}

/** §9.2: flat unless the move is at least a quarter of an ATR, expressed as a percent of price. */
export function priceDirection(ret4hPct: number, atr4h: number, close: number): Direction {
  if (close === 0) return 'flat';
  const thresholdPct = (0.25 * atr4h / close) * 100;
  if (ret4hPct >= thresholdPct) return 'up';
  if (ret4hPct <= -thresholdPct) return 'down';
  return 'flat';
}

const sign = (value: number): Direction => (value > 0 ? 'up' : value < 0 ? 'down' : 'flat');

export function p4Label(price: Direction, spot: Direction, perp: Direction): P4Label {
  if (price === 'up' && spot === 'up') return 'SPOT_LED';
  if (price === 'up' && (spot === 'flat' || spot === 'down') && perp === 'up') return 'PERP_LED';
  if (price === 'down' && spot === 'up' && perp === 'down') return 'ABSORPTION';
  if (price === 'flat' && spot === 'down' && perp === 'up') return 'DISTRIBUTION';
  return 'NONE';
}

export function labelFeatures(input: LabelInput): Partial<Record<WebFeatureKey, WebFeatureValue>> {
  const { ret4hPct, atr4h, close, cvdSpot4h, cvdPerp4h } = input;

  // NONE is a LABEL, not a fallback for missing input. A symbol with no spot market cannot be
  // classified by a table whose first two rows read the spot column, and answering NONE would
  // say "we looked and saw nothing" about a market we never had.
  if (ret4hPct === null || atr4h === null || close === null || cvdSpot4h === null || cvdPerp4h === null) {
    return { 'label.p4': { ok: false, why: 'not_applicable' } };
  }

  const label = p4Label(priceDirection(ret4hPct, atr4h, close), sign(cvdSpot4h), sign(cvdPerp4h));
  return { 'label.p4': { ok: true, value: label } };
}
