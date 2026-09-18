import type { AggregateMetricPoint, CountingConvention, InstrumentId } from '@trade-automation/contracts';
import { formatCompact } from '../chart/compact-number.format';
import { memberDisplayName } from './venue-names';

/**
 * architecture/aggregate-oi.md §1 "What the reader sees" — the words a coverage change or a
 * coverage set is shown with. Pure; the chip component and the seam markers both read from here.
 */

/**
 * §1 point 2 — a seam marker's text: the members that joined (`+Hyperliquid`) and left
 * (`−Hyperliquid`, U+2212) between the previous emitted bar and this one. Empty when unchanged.
 */
export function coverageDiffText(previous: readonly InstrumentId[], next: readonly InstrumentId[]): string {
  const added = next.filter((m) => !previous.includes(m)).map((m) => `+${memberDisplayName(m)}`);
  const removed = previous.filter((m) => !next.includes(m)).map((m) => `−${memberDisplayName(m)}`);
  return [...added, ...removed].join(' ');
}

export interface CoverageChip {
  text: string;
  complete: boolean;
  /** Per-venue USD at this bar and its share of the total — the chip's tooltip. */
  tooltip: string;
}

/**
 * §1 point 3 — the header chip for the bar being read. `members` = the configured members in
 * config order (the aggregate definition); the missing ones are NAMED, never implied:
 * `3/3 · Binance · Bybit · Hyperliquid`, `2/3 · Binance · Bybit — без Hyperliquid`.
 */
export function coverageChip(point: AggregateMetricPoint, members: readonly InstrumentId[]): CoverageChip {
  const configured = members.length > 0 ? members : point.coverage;
  const present = configured.filter((m) => point.coverage.includes(m));
  const missing = configured.filter((m) => !point.coverage.includes(m));
  const head = [`${present.length}/${configured.length}`, ...present.map(memberDisplayName)].join(' · ');
  const text = missing.length > 0 ? `${head} — без ${missing.map(memberDisplayName).join(', ')}` : head;
  return { text, complete: point.complete, tooltip: coverageTooltip(point, configured) };
}

function usd(value: number): string {
  return `$${formatCompact(value)}`;
}

/**
 * The chip tooltip: one line per configured member — its USD notional at this bar (`members[]`)
 * and its share of the total; a missing member says so. Shares are of the USD total when every
 * present leg has a notional, else of the base-unit total (and the line says which).
 */
export function coverageTooltip(point: AggregateMetricPoint, members: readonly InstrumentId[]): string {
  const byNotional = point.members.length > 0 && point.members.every((m) => m.notional !== undefined);
  const total = point.members.reduce((sum, m) => sum + (byNotional ? m.notional! : m.value), 0);
  const lines = members.map((id) => {
    const leg = point.members.find((m) => m.source === id);
    if (!leg) {
      return `${memberDisplayName(id)}: нет в этой свече`;
    }
    const share = total > 0 ? ((byNotional ? leg.notional! : leg.value) / total) * 100 : 0;
    const amount = leg.notional === undefined ? 'нет USD' : usd(leg.notional);
    return `${memberDisplayName(id)}: ${amount} · ${share.toFixed(1)} %`;
  });
  const sum = point.notional === undefined ? 'нет USD-суммы' : usd(point.notional);
  const basis = byNotional ? '' : ' (доли по количеству BTC)';
  return [...lines, `Итого: ${sum}${basis}`, 'USDT и USDC сложены 1:1'].join('\n');
}

export interface ConventionBadge {
  text: string;
  tooltip: string;
}

/** §1 point 4 / §2 — the counting-convention badge next to the unit, tooltip in plain Russian. */
export function conventionBadge(convention: CountingConvention): ConventionBadge {
  if (convention === 'as-published') {
    return {
      text: 'as published',
      tooltip:
        'Сумма «как публикуют биржи»: у Bybit взято основное поле, где каждая позиция посчитана дважды ' +
        '(покупатель и продавец), у Binance и Hyperliquid — один раз. Так складывают CoinGlass и, ' +
        'предположительно, Coinalyze. В одной сумме смешаны два способа счёта.',
    };
  }
  return {
    text: 'one-sided',
    tooltip:
      'Открытый интерес посчитан «в одну сторону»: одна открытая позиция = 1 на всех биржах. ' +
      'Bybit в своём основном поле считает обе стороны (×2), поэтому суммы в стиле CoinGlass/Coinalyze ' +
      'выглядят примерно на 16 % выше нашей. Это не ошибка, а один способ счёта для всех бирж. ' +
      'Coinalyze численно не проверяли — что они считают так же, мы предполагаем по CoinGlass.',
  };
}
