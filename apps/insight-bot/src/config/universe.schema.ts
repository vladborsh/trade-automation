import { z } from 'zod';

/**
 * architecture/insight-bot-system-design.md §2.3 — `config/universe.yaml`: the top-30 USD-M
 * perps, revised by hand monthly, plus the stage-1 `signal_set`.
 *
 * `binance_spot` is optional on purpose: "a symbol with no `binance_spot` simply has no spot
 * CVD; features that need it are `null` for it, never silently zero" (§2.3). `bybit_linear`
 * and `okx_swap` are optional for the same reason — a perp Binance lists first is not yet on
 * the other two venues.
 */
export const UniverseSymbolSchema = z
  .object({
    id: z.string().regex(/^[A-Z0-9]+$/, 'id must be the Binance USD-M symbol, e.g. BTCUSDT'),
    base: z.string().min(1),
    quote: z.string().min(1),
    binance_perp: z.string().min(1),
    binance_spot: z.string().min(1).optional(),
    bybit_linear: z.string().min(1).optional(),
    okx_swap: z.string().min(1).optional(),
    // IB-036: the CoinGecko coin whose market cap the dashboard charts. Optional — a perp with no
    // listed coin simply has no market-cap series, never a zero one (the §2.3 rule again).
    coingecko_id: z.string().min(1).optional(),
    // A `date` in SQL (§3.2). yaml parses an unquoted 2020-01-01 to a JS Date, so accept either
    // and normalise to the ISO day — the value is a calendar day, never an instant.
    listed_perp: z.union([z.string(), z.date()]).transform(toIsoDay),
    // IB-031: the dashboard's "top 20" picker. Optional because the file is ALREADY ordered by
    // 30-day quote volume by construction (see its header), so the rank is the position unless
    // a revision wants to state it explicitly.
    // (coingecko_id is declared above by IB-036, which landed first and needs it for the same
    // reason — one declaration, not two.)
    volume_rank: z.number().int().positive().optional(),
  })
  .strict();
export type UniverseSymbol = z.infer<typeof UniverseSymbolSchema>;

function toIsoDay(value: string | Date, ctx: z.RefinementCtx): string {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `listed_perp must be a YYYY-MM-DD date, got '${String(value)}'` });
    return z.NEVER;
  }
  return text;
}

export const UniverseFileSchema = z
  .object({
    signal_set: z.array(z.string().min(1)).min(1),
    symbols: z.array(UniverseSymbolSchema).min(1),
  })
  .strict()
  .superRefine((file, ctx) => {
    const ids = file.symbols.map((s) => s.id);
    const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
    if (duplicate !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate symbol id '${duplicate}'` });
    }
    // The stage-1 playbooks evaluate only `signal_set` (§2.3); a member that is not in the
    // universe would silently never be evaluated, so it is a boot failure instead.
    for (const id of file.signal_set) {
      if (!ids.includes(id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `signal_set references '${id}', which is not in symbols` });
      }
    }
  });
export type UniverseFile = z.infer<typeof UniverseFileSchema>;
