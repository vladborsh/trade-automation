/**
 * IB-099 item 1 — the flag on an economic event's badge, by the event's currency (`country` in
 * the feed is a currency code: USD, EUR…). Inline SVG, not emoji: Windows renders flag emoji as
 * two letters. Simplified to read at 24 px inside a circle; an identifier, so never translated.
 * The chart marks USD only today (`isMarkedEvent`); the map is open for the rest when that widens.
 */
const wrap = (code: string, body: string): string =>
  `<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><defs><clipPath id="flag-${code}"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#flag-${code})">${body}</g></svg>`;

const US_STRIPES = Array.from({ length: 7 }, (_, i) => `<rect y="${i * 3.43}" width="24" height="1.72" fill="#b22234"/>`).join('');

export const FLAG_SVG: Readonly<Record<string, string>> = {
  USD: wrap('USD', `<rect width="24" height="24" fill="#fff"/>${US_STRIPES}<rect width="11" height="12" fill="#3c3b6e"/>`),
  EUR: wrap('EUR', `<rect width="24" height="24" fill="#039"/>${Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    return `<circle cx="${(12 + 6.5 * Math.cos(a)).toFixed(2)}" cy="${(12 + 6.5 * Math.sin(a)).toFixed(2)}" r="1" fill="#fc0"/>`;
  }).join('')}`),
  GBP: wrap('GBP', '<rect width="24" height="24" fill="#012169"/><path d="M0 0L24 24M24 0L0 24" stroke="#fff" stroke-width="4"/><path d="M0 0L24 24M24 0L0 24" stroke="#c8102e" stroke-width="1.5"/><path d="M12 0V24M0 12H24" stroke="#fff" stroke-width="6"/><path d="M12 0V24M0 12H24" stroke="#c8102e" stroke-width="3.5"/>'),
  JPY: wrap('JPY', '<rect width="24" height="24" fill="#fff"/><circle cx="12" cy="12" r="5.5" fill="#bc002d"/>'),
  CHF: wrap('CHF', '<rect width="24" height="24" fill="#d52b1e"/><path d="M10 6h4v4h4v4h-4v4h-4v-4H6v-4h4z" fill="#fff"/>'),
  CAD: wrap('CAD', '<rect width="24" height="24" fill="#fff"/><rect width="6" height="24" fill="#d52b1e"/><rect x="18" width="6" height="24" fill="#d52b1e"/><path d="M12 7l1.2 2.6 2.3-.7-.9 3.3 1.8.6-3 2.4.3 1.8H11.3l.3-1.8-3-2.4 1.8-.6-.9-3.3 2.3.7z" fill="#d52b1e"/>'),
};

/** The flag for a currency code, or null — the badge then shows the code itself. */
export function flagFor(country: string | null | undefined): string | null {
  return country ? FLAG_SVG[country.toUpperCase()] ?? null : null;
}
