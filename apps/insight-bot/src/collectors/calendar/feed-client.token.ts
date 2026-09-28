import { FeedClient } from '@trade-automation/calendar-core';

/**
 * DI token for the lifted `FeedClient` (an interface, so Nest needs a symbol to inject it by).
 * The same shape signal-server uses, which is what lets a spec substitute a canned snapshot
 * without touching the collector.
 */
export const FEED_CLIENT = Symbol('FEED_CLIENT');
export type { FeedClient };
