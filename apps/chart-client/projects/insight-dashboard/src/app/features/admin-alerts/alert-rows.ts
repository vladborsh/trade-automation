import {
  OI_DIVERGENCE_TFS, OiDivergenceParamsSchema, type OiDivergenceParams, type OiDivergenceTf, type WebAlertSymbolRefusal,
  type WebOiDivergenceAlert, type WebOiDivergenceSkipRow,
} from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';

/**
 * IB-112 (architecture/oi-divergence-design-2026-11-04.md V12, V17) — the admin alerts page's
 * mapping, pure and spec'd: journal and skip rows as shown, the params form both ways, the refusal
 * sentence for a coin that cannot be added.
 */

const MINUS = '−';
/** UTC `YYYY-MM-DD HH:MM` of unix seconds. */
export const utcMinute = (sec: number): string => new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 16);

/** `−2.4 %`, `+6.8 %`: one decimal, the page's minus; `—` when there is nothing to compare. */
export function pctText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const text = Math.abs(value).toFixed(1);
  return `${Number(text) === 0 ? '' : value < 0 ? MINUS : '+'}${text} %`;
}

/** The move from the price at sending to a later close, in percent; null when either is missing. */
export const movePct = (from: number | null, to: number | null): number | null =>
  from === null || to === null || from <= 0 ? null : (to / from - 1) * 100;

export interface AlertRow {
  id: number;
  confirmed: string;
  symbol: string;
  tf: OiDivergenceTf;
  direction: StringKey;
  price: string;
  oi: string;
  /** Pivots in the run when this is a repeat (3 = «третий подряд»); null for a first alert. */
  run: number | null;
  status: { key: StringKey; recipients: number };
  /** Price 4 h / 24 h after sending, against the price at sending (V12); `—` until the outcome job fills it. */
  after4h: string;
  after24h: string;
}

export function toAlertRow(a: WebOiDivergenceAlert): AlertRow {
  return {
    id: a.id,
    confirmed: utcMinute(a.confirmedAt),
    symbol: a.symbol,
    tf: a.tf,
    direction: a.direction === 'bullish' ? 'alerts.direction.bullish' : 'alerts.direction.bearish',
    price: pctText(movePct(a.a.price, a.b.price)),
    oi: pctText(movePct(a.a.oi, a.b.oi)),
    run: a.runLength > 2 ? a.runLength : null,
    // IB-116 (V33): a backfilled row is history first — never sent, never late, and must not read as «journal only»
    // (which means "found live while sending was off"); then late: never sent, whatever the switch said (V10)
    status: a.source === 'backfill'
      ? { key: 'alerts.status.history', recipients: 0 }
      : a.late
      ? { key: 'alerts.status.late', recipients: 0 }
      : a.firedAt !== null
        ? { key: 'alerts.status.sent', recipients: a.recipients }
        : { key: 'alerts.status.journalOnly', recipients: 0 },
    after4h: pctText(movePct(a.priceAtFire, a.price4h)),
    after24h: pctText(movePct(a.priceAtFire, a.price24h)),
  };
}

export interface SkipRow {
  at: string;
  symbol: string;
  tf: OiDivergenceTf;
  bar: string;
  hole: string;
}

export function toSkipRow(s: WebOiDivergenceSkipRow): SkipRow {
  return { at: utcMinute(s.at), symbol: s.symbol, tf: s.tf, bar: utcMinute(s.barTime), hole: `${utcMinute(s.holeFrom)} – ${utcMinute(s.holeTo)}` };
}

/** The params form: every number as the admin typed it (a string), so a half-typed value is not lost. */
export interface ParamsForm {
  perTf: Record<OiDivergenceTf, { n: string; k: string; w: string }>;
  atrMult: string;
  oiMedianMult: string;
  priceLineTolAtrMult: string;
  oiLineTolMedianMult: string;
}

export function paramsToForm(p: OiDivergenceParams): ParamsForm {
  const perTf = Object.fromEntries(OI_DIVERGENCE_TFS.map((tf) => [tf, { n: String(p.perTf[tf].n), k: String(p.perTf[tf].k), w: String(p.perTf[tf].w) }])) as ParamsForm['perTf'];
  return {
    perTf, atrMult: String(p.atrMult), oiMedianMult: String(p.oiMedianMult),
    priceLineTolAtrMult: String(p.priceLineTolAtrMult), oiLineTolMedianMult: String(p.oiLineTolMedianMult),
  };
}

/**
 * The form back to params, validated by the contract's own schema (the server parses with the same):
 * `null` when any field is not a number or out of range, so the page never sends a value the server
 * would refuse. An empty field is not zero.
 */
export function formToParams(f: ParamsForm): OiDivergenceParams | null {
  const num = (s: string): number => (s.trim() === '' ? Number.NaN : Number(s.trim().replace(',', '.')));
  const candidate = {
    perTf: Object.fromEntries(OI_DIVERGENCE_TFS.map((tf) => [tf, { n: num(f.perTf[tf].n), k: num(f.perTf[tf].k), w: num(f.perTf[tf].w) }])),
    atrMult: num(f.atrMult),
    oiMedianMult: num(f.oiMedianMult),
    priceLineTolAtrMult: num(f.priceLineTolAtrMult),
    oiLineTolMedianMult: num(f.oiLineTolMedianMult),
  };
  const parsed = OiDivergenceParamsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** What the admin typed, as the venue spells a symbol: trimmed, upper case, no separators. */
export const normalizeSymbol = (typed: string): string => typed.trim().toUpperCase().replace(/[\s/_-]+/g, '');

/** The sentence for a refused coin (409), from the server's code; anything else is the generic failure. */
export function symbolRefusalKey(code: unknown): StringKey {
  const known: Record<WebAlertSymbolRefusal, StringKey> = {
    not_found: 'alerts.refused.not_found',
    not_perpetual: 'alerts.refused.not_perpetual',
    not_trading: 'alerts.refused.not_trading',
    already_listed: 'alerts.refused.already_listed',
    venue_unavailable: 'alerts.refused.venue_unavailable',
  };
  return typeof code === 'string' && code in known ? known[code as WebAlertSymbolRefusal] : 'alerts.failed';
}
