import type { WebUniverseSummaryRow } from '@trade-automation/contracts';
import { fractionSigned, signed } from '../market/market.format';
import type { PaneData } from './pane-data';
import { baseAsset } from './panels.model';
import { toCvdSegments } from './series.adapter';
import type { Sign } from './symbol-picker.rows';

/**
 * The "now" tiles beside the chart: the latest open interest, funding, CVD and long/short.
 *
 * Two sources, and each tile says which by what it shows. The chart's own window gives the latest
 * OI, CVD and long/short points. The live summary gives the 24 h OI change and the funding
 * predicted for the interval in progress with its settlement time. When the summary is missing,
 * funding falls back to the window's last predicted point and the 24 h change is simply absent:
 * it is never derived from a window that may be shorter than 24 h.
 *
 * Every figure is `null` when there is nothing to show, never `0`.
 */
export interface NowTiles {
  /** The latest open interest in the BASE asset (`sumOpenInterest`), e.g. BTC for BTCUSDT. */
  oi: string | null;
  oiUnit: string;
  oiChange: string | null;
  oiChangeSign: Sign | null;
  /** Signed percentage per interval, four places: `+0.0123`. */
  funding: string | null;
  fundingSign: Sign | null;
  /** `HH:mm`, UTC. Only from the live summary. */
  nextFunding: string | null;
  /** Cumulative taker delta over the window, in the BASE asset. */
  cvd: string | null;
  cvdSign: Sign | null;
  cvdUnit: string;
  ls: string | null;
}

const sign = (v: number | null): Sign | null => (v === null ? null : v > 0 ? 1 : v < 0 ? -1 : 0);

function latest<T extends { time: number }>(points: readonly T[]): T | null {
  let best: T | null = null;
  for (const p of points) if (best === null || p.time > best.time) best = p;
  return best;
}

/** Whole contracts with thousands separators; one decimal under 100, where whole numbers lie. */
function grouped(v: number): string {
  const digits = Math.abs(v) < 100 ? 1 : 0;
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function signedGrouped(v: number): string {
  const body = grouped(Math.abs(v));
  return `${v < 0 ? '−' : '+'}${body}`;
}

export function hhmmUtc(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(11, 16);
}

export function nowTiles(data: PaneData | null, row: WebUniverseSummaryRow | null, symbol: string): NowTiles {
  const oiPoint = data ? latest(data.openInterest) : null;
  const segments = data ? toCvdSegments(data.candles.candles) : [];
  const lastSegment = segments.at(-1);
  const cvd = lastSegment?.at(-1)?.value ?? null;
  const lsPoint = data ? latest(data.longShort.points) : null;
  const predicted = data ? latest(data.funding.predicted) : null;
  const funding = row?.fundingRate ?? predicted?.rate ?? null;
  const oiChange = row?.oiChangePct24h ?? null;
  return {
    oi: oiPoint ? grouped(oiPoint.value) : null,
    oiUnit: baseAsset(symbol),
    oiChange: signed(oiChange, 1),
    oiChangeSign: sign(oiChange),
    funding: fractionSigned(funding, 4),
    fundingSign: sign(funding),
    nextFunding: hhmmUtc(row?.nextFundingTimeMs ?? null),
    cvd: cvd === null ? null : signedGrouped(cvd),
    cvdSign: sign(cvd),
    cvdUnit: baseAsset(symbol),
    ls: lsPoint ? lsPoint.ratio.toFixed(2) : null,
  };
}
