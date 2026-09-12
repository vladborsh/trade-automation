import { z } from 'zod';
import { InstrumentIdSchema } from './instrument';
import { TimeframeSchema } from './timeframe';
import { StrategyTierSchema } from './strategy';

export const SignalKindSchema = z.enum(['entry', 'exit', 'info']);
export type SignalKind = z.infer<typeof SignalKindSchema>;

export const DirectionSchema = z.enum(['long', 'short', 'flat']);
export type Direction = z.infer<typeof DirectionSchema>;

/** architecture/live-signal-server.md §3.4 — overlay primitive vocabulary. */
export const OverlayMarkerSchema = z.object({
  type: z.literal('marker'),
  time: z.number(),
  position: z.enum(['above', 'below']),
  shape: z.enum(['arrowUp', 'arrowDown', 'circle', 'square']),
  color: z.string().optional(),
  text: z.string().optional(),
});

export const OverlayPriceLineSchema = z.object({
  type: z.literal('priceLine'),
  price: z.number(),
  from: z.number().optional(),
  to: z.number().optional(),
  style: z.enum(['solid', 'dashed']).optional(),
  color: z.string().optional(),
  label: z.string().optional(),
});

export const OverlayRaySchema = z.object({
  type: z.literal('ray'),
  time: z.number(),
  price: z.number(),
  color: z.string().optional(),
  label: z.string().optional(),
});

export const OverlayRectSchema = z.object({
  type: z.literal('rect'),
  from: z.number(),
  to: z.number(),
  top: z.number(),
  bottom: z.number(),
  color: z.string().optional(),
  label: z.string().optional(),
});

export const OverlayLineSchema = z.object({
  type: z.literal('line'),
  points: z.array(z.object({ time: z.number(), price: z.number() })),
  color: z.string().optional(),
  label: z.string().optional(),
  /** architecture/live-signal-server.md §11.6 — matches priceLine's style field. */
  style: z.enum(['solid', 'dashed']).optional(),
});

export const OverlayPrimitiveSchema = z.discriminatedUnion('type', [
  OverlayMarkerSchema,
  OverlayPriceLineSchema,
  OverlayRaySchema,
  OverlayRectSchema,
  OverlayLineSchema,
]);
export type OverlayPrimitive = z.infer<typeof OverlayPrimitiveSchema>;

const MetaValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const SignalSchema = z.object({
  id: z.string().uuid(),
  strategyId: z.string().min(1),
  instrument: InstrumentIdSchema,
  timeframe: TimeframeSchema,
  time: z.number().int().nonnegative(),
  /** architecture/live-signal-server.md §11.1 — required; a consumer cannot receive a signal without it. */
  tier: StrategyTierSchema,
  kind: SignalKindSchema,
  direction: DirectionSchema,
  levels: z
    .object({
      entry: z.number().optional(),
      stop: z.number().optional(),
      target: z.number().optional(),
    })
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
  overlay: z.array(OverlayPrimitiveSchema),
  meta: z.record(z.string(), MetaValueSchema),
});
export type Signal = z.infer<typeof SignalSchema>;
