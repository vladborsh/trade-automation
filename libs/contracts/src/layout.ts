import { z } from 'zod';
import { InstrumentIdSchema } from './instrument';
import { MetricKindSchema } from './metric';

/** architecture/chart-layouts.md §2.2 — named multi-panel layout-setups. */
export const PanelKindSchema = z.enum(['candles', 'metric']);
export type PanelKind = z.infer<typeof PanelKindSchema>;

export const PanelSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    kind: PanelKindSchema,
    instrument: InstrumentIdSchema,
    metric: MetricKindSchema.optional(), // §4.2; required iff kind === 'metric'
    signals: z.boolean().default(false),
    title: z.string().min(1).optional(), // default: instrument.displayName (+ " · Open interest")
  })
  .superRefine((p, ctx) => {
    if (p.kind === 'metric' && !p.metric) ctx.addIssue({ code: 'custom', message: 'metric panel needs `metric`' });
    if (p.kind === 'candles' && p.metric) ctx.addIssue({ code: 'custom', message: 'candles panel must not set `metric`' });
    if (p.kind === 'metric' && p.signals) ctx.addIssue({ code: 'custom', message: 'signals cannot render on a metric panel' });
  });
export type Panel = z.infer<typeof PanelSchema>;

export const LayoutGridSchema = z.object({
  columns: z.number().int().min(1).max(4),
  rows: z.number().int().min(1).max(4),
});
export type LayoutGrid = z.infer<typeof LayoutGridSchema>;

export const LayoutSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    grid: LayoutGridSchema,
    panels: z.array(PanelSchema).min(1).max(6),
  })
  .superRefine((l, ctx) => {
    if (l.panels.length > l.grid.columns * l.grid.rows) ctx.addIssue({ code: 'custom', message: 'more panels than grid cells' });
    if (new Set(l.panels.map((p) => p.id)).size !== l.panels.length) ctx.addIssue({ code: 'custom', message: 'duplicate panel id' });
  });
export type Layout = z.infer<typeof LayoutSchema>;

export const LayoutsResponseSchema = z.array(LayoutSchema);
export type LayoutsResponse = z.infer<typeof LayoutsResponseSchema>;
