import type { WebInsightChart, WebInsightStatement } from '@trade-automation/contracts';
import type { StringKey } from '../../../i18n/keys';
import { baseOf } from './insight-card';

/**
 * IB-119 — what the chart's caption and one-line legend SAY, per rule, as keys to translate. Pure.
 * The legend names what is drawn and nothing else: a second series, the band, the reference line,
 * the highlighted moment. A single series is named by the caption. No label forecasts (D20).
 */
export interface ChartPhrase {
  key: StringKey;
  params: Record<string, string | number>;
  nested: Record<string, StringKey>;
}
export type Swatch = `s-${string}` | 'band' | 'ref' | 'focus';

const phrase = (key: string, params: Record<string, string | number> = {}, nested: Record<string, string> = {}): ChartPhrase =>
  ({ key: key as StringKey, params, nested: nested as Record<string, StringKey> });

/** The reference line's meaning per rule: zero, the period's start, 1.0 (as many longs as shorts), 50 %. */
const REF_KEY: Partial<Record<WebInsightStatement['ruleId'], string>> = {
  R1: 'ichart.ref.zero', R2: 'ichart.ref.zero', R3: 'ichart.ref.zero', R5: 'ichart.ref.zero', R10: 'ichart.ref.zero',
  R4: 'ichart.ref.start', R11: 'ichart.ref.start_a', R6: 'ichart.ref.ls', R7: 'ichart.ref.half',
};

export function chartTexts(s: WebInsightStatement, c: WebInsightChart): { caption: ChartPhrase; legend: Array<{ swatch: Swatch; phrase: ChartPhrase }>; muted: string | null } {
  const symbol = typeof s.params['symbol'] === 'string' ? s.params['symbol'] : '';
  const tf = typeof s.params['tf'] === 'string' ? s.params['tf'] : '';
  const caption = phrase(`ichart.caption.${s.ruleId}`, { base: baseOf(symbol), tf }, { window: `market.period.${s.basis.window}` });

  // mirrored liquidations: the side the statement names in its colour, the other muted (bars, legend, corner)
  const side = s.params['side'];
  const muted = c.kind === 'bars_mirror' && (side === 'long' || side === 'short') ? (side === 'long' ? 'short' : 'long') : null;
  const legend: Array<{ swatch: Swatch; phrase: ChartPhrase }> = [];
  if (c.series.length > 1) for (const x of c.series) legend.push({ swatch: x.key === muted ? 's-muted' : `s-${x.key}`, phrase: phrase(`ichart.series.${x.key}`) });
  if (c.band) legend.push({ swatch: 'band', phrase: phrase(s.ruleId === 'R2' ? 'ichart.band.windows' : 'ichart.band.settlements') });
  const ref = REF_KEY[s.ruleId];
  if (c.ref !== null && ref) legend.push({ swatch: 'ref', phrase: phrase(ref) });
  if (c.marks.length === 2) legend.push({ swatch: 'focus', phrase: phrase('ichart.focus.ab') });
  else if (c.highlight && c.highlight.from !== c.highlight.to) legend.push({ swatch: 'focus', phrase: phrase('ichart.focus.cascade') });
  else if (c.highlight) legend.push({ swatch: 'focus', phrase: phrase('ichart.focus.now') });
  return { caption, legend, muted };
}
