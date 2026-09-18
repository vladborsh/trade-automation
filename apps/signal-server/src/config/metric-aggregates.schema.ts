import { z } from 'zod';
import { MetricAggregate, MetricAggregateSchema, MetricKind, Venue } from '@trade-automation/contracts';

/** config/metric-aggregates.yaml — cross-venue metric aggregates (architecture/aggregate-oi.md §3.3). */
export const MetricAggregatesFileSchema = z
  .object({
    aggregates: z.array(MetricAggregateSchema).default([]),
  })
  .superRefine((f, ctx) => {
    if (new Set(f.aggregates.map((a) => a.id)).size !== f.aggregates.length) {
      ctx.addIssue({ code: 'custom', message: 'duplicate aggregate id' });
    }
  });
export type MetricAggregatesFile = z.infer<typeof MetricAggregatesFileSchema>;

/**
 * architecture/aggregate-oi.md §3.3 — boot fails on an aggregate member whose venue has no metric
 * adapter, or whose adapter does not support the aggregate's metric (same rule as every config
 * file, base §4.7). Checked against the adapters actually built for this MARKET_DATA_MODE, so in
 * replay mode the replay adapters count. Pure: `adapters` is just (venue → supported metrics).
 */
export function assertAggregateMembersIngestible(
  aggregates: readonly MetricAggregate[],
  adapters: ReadonlyMap<Venue, { supports: readonly MetricKind[] }>,
): void {
  for (const aggregate of aggregates) {
    for (const member of aggregate.members) {
      const adapter = adapters.get(member.venue);
      if (!adapter) {
        throw new Error(
          `metric-aggregates.yaml: aggregate '${aggregate.id}' member '${member.id}' is on venue ` +
            `'${member.venue}', which has no metric adapter. Refusing to boot with this configuration.`,
        );
      }
      if (!adapter.supports.includes(aggregate.metric)) {
        throw new Error(
          `metric-aggregates.yaml: aggregate '${aggregate.id}' member '${member.id}': the '${member.venue}' ` +
            `metric adapter does not support '${aggregate.metric}'. Refusing to boot with this configuration.`,
        );
      }
    }
  }
}
