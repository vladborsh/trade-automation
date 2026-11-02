import { OkxInstrument } from '../../collectors/okx/payloads';

/**
 * OKX sizes are denominated in **contracts**, not base units, and the contract size differs by
 * orders of magnitude between instruments. Measured from
 * `/api/v5/public/instruments?instType=SWAP` on 2026-09-28:
 *
 * | instId | ctVal | ctValCcy | ctMult |
 * |---|---|---|---|
 * | `BTC-USDT-SWAP` | 0.01 | BTC | 1 |
 * | `ETH-USDT-SWAP` | 0.1 | ETH | 1 |
 * | `SOL-USDT-SWAP` | 1 | SOL | 1 |
 * | `DOGE-USDT-SWAP` | 1000 | DOGE | 1 |
 *
 * So a liquidation of `sz: "12"` is 0.12 BTC on one instrument and 12 000 DOGE on another. Storing
 * `sz` as `liquidations.qty` would be wrong by up to five orders of magnitude, and `notional`
 * feeds the cascade features P3 reads (§9.1) — a silent error there is a silently wrong playbook,
 * not a cosmetic one. Hence this table is loaded at boot and a symbol without it is **skipped
 * with a warning rather than written with a guessed size**.
 *
 * Binance and Bybit quote linear-perp sizes in base units already; this conversion is OKX-only,
 * which is exactly why it is easy to miss.
 */
export interface ContractSpec {
  instId: string;
  /** Base units per contract — `ctVal × ctMult`. */
  baseUnitsPerContract: number;
  ctValCcy: string;
}

export function parseContractSpec(instrument: OkxInstrument): ContractSpec | null {
  const ctVal = Number(instrument.ctVal);
  const ctMult = Number(instrument.ctMult === '' || instrument.ctMult === undefined ? '1' : instrument.ctMult);
  if (!Number.isFinite(ctVal) || ctVal <= 0 || !Number.isFinite(ctMult) || ctMult <= 0) return null;
  return {
    instId: instrument.instId,
    baseUnitsPerContract: ctVal * ctMult,
    ctValCcy: instrument.ctValCcy,
  };
}

/** Builds the lookup, skipping anything whose contract size the venue did not state usably. */
export function contractSpecs(instruments: readonly OkxInstrument[]): Map<string, ContractSpec> {
  const specs = new Map<string, ContractSpec>();
  for (const instrument of instruments) {
    const spec = parseContractSpec(instrument);
    if (spec !== null) specs.set(spec.instId, spec);
  }
  return specs;
}

/** Contracts → base units. */
export function contractsToBase(sz: string | number, spec: ContractSpec): number {
  const contracts = Number(sz);
  if (!Number.isFinite(contracts)) throw new Error(`OKX size is not a number: ${String(sz)}`);
  return contracts * spec.baseUnitsPerContract;
}
