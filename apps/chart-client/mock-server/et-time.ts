/**
 * Plain-`Intl` ET (America/New_York) helpers for the mock calendar server —
 * no date library, mirrors `src/app/features/calendar/et-time.ts`'s
 * "no new dependency" restraint on the server side too.
 */

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

interface EtWallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: string; // 'Sun'..'Sat'
}

function etWallClock(ms: number): EtWallClock {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24, // Node/ICU can render midnight as '24'
    minute: Number(get('minute')),
    weekday: get('weekday').replace('.', ''),
  };
}

export function etDayString(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/**
 * Sunday 00:00 America/New_York of the week containing `nowMs`, as UTC ms
 * (architecture/economic-calendar.md §1.2's week window). Resolved by
 * trying both possible ET UTC offsets (EDT −4h / EST −5h) for the target
 * calendar date and keeping whichever lands exactly on ET midnight.
 */
export function startOfThisWeekEtUtcMs(nowMs: number): number {
  const parts = etWallClock(nowMs);
  const dow = WEEKDAY_INDEX[parts.weekday];
  for (const utcHourGuess of [4, 5]) {
    const candidate = Date.UTC(parts.year, parts.month - 1, parts.day - dow, utcHourGuess, 0, 0);
    if (etWallClock(candidate).hour === 0) {
      return candidate;
    }
  }
  // Should be unreachable for any real date; fall back to the EST guess rather than throw.
  return Date.UTC(parts.year, parts.month - 1, parts.day - dow, 5, 0, 0);
}
