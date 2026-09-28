/**
 * The kinds of change one ingestion pass can record for an event
 * (architecture/economic-calendar.md §3.3, §3.5). Lifted with the diff (IB-010) because both
 * `diffSnapshot` and any consumer of a revision row need it; signal-server's `calendar.events.ts`
 * re-exports it, so its in-process bus types are unchanged.
 */
export type CalendarEventChange = 'created' | 'updated' | 'removed' | 'actual';
