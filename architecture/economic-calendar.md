# Architecture note — economic calendar (news events) for the signal server

**Role:** Architect. **Date:** 2026-09-16. **Status:** design, routed to
Software Engineer (§10). Nothing here is implemented.
**Amended 2026-09-18 (§11):** impact filter becomes a set (holiday is not a rung),
USD/EUR/GBP + medium/high/holiday as editable persisted defaults, currency flags, audible
pre-event alert. §11 supersedes the filter parts of §7.1.

**Extends:** [`live-signal-server.md`](live-signal-server.md) (base — §3
contracts, §4 server, §4.3/§6 storage, §3.5 wire) and
[`chart-layouts.md`](chart-layouts.md) (the client's shell/panel-grid and the
`MetricStore`/`MetricIngestionService` pattern this note mirrors). Infra
pins from [`live-signal-server-infra.md`](live-signal-server-infra.md) are
reused unchanged (§4.5). Section numbers refer to *this* note unless
prefixed `base §` / `layouts §`.

**Inputs read:** the three notes above; `apps/signal-server/src/{storage/*,
market-data/metrics/*, api/ws/live.gateway.ts, config/env.schema.ts,
observability/health.controller.ts, app.module.ts}`;
`libs/contracts/src/wire.ts`; `apps/chart-client/src/app/{app.ts,
app.config.ts, features/terminal/terminal-shell.component.ts,
core/api/live.socket.ts}`; `IDEAS-BACKLOG.md` ("Scheduled-macro-event
reaction"); `PROJECT.md`. **Live fetches** (2026-09-16 15:01 UTC) of
`https://nfs.faireconomy.media/ff_calendar_thisweek.{json,xml,csv}` and
probes of `nextweek`, `lastweek`, `today`, `tomorrow` variants — §1.

---

## 0. What the user asked for, restated as requirements

> Add an economic-calendar / news-events feature to the live system. Data
> from `ff_calendar_thisweek.json`. Weekly calendar view; a daily
> notification listing that day's events; a notification when each event
> fires; every event stored; event results (actuals) stored for later
> historical use.

| # | Requirement | Where designed |
|---|---|---|
| R1 | Ingest the ForexFactory weekly feed continuously | §3 ingestion |
| R2 | Full weekly calendar view | §7 client, §6 REST |
| R3 | Daily "what happens today" notification | §5.2 |
| R4 | Notification at each event's scheduled time | §5.3 |
| R5 | Every event persisted, forever (history accumulates across weeks) | §2 model, §4 storage, §3.4 week roll |
| R6 | Event **results** (actuals) persisted for later historical use | §3.5 — **partially satisfiable from this feed; see §1.3 and D5** |

**Relationship to the research programme (explicit, per the brief):** this is
**infrastructure, not a strategy.** `IDEAS-BACKLOG.md` → "Scheduled-macro-event
reaction, BTC/ETH — first entry into the news pillar" (logged 2026-08-26,
not prioritized, not rejected) needs "a dated event table" to backtest
against; that entry planned to have Researcher hand-assemble CPI/FOMC/NFP
timestamps from BLS/Fed schedules. The `EventStore` designed here becomes
that table, accumulating from the day it is deployed, for every currency and
impact level, with forecast/previous and (where obtainable) actual. It
**unblocks** that backlog idea; it does not action it. No backtesting, no
signal logic, no strategy-context extension is in scope here (§9).

---

## 1. What the live feed actually is (fetched, not remembered)

### 1.1 Endpoints

| URL (`https://nfs.faireconomy.media/…`) | Result |
|---|---|
| `ff_calendar_thisweek.json` | **200**, `application/json`, 14 079 B, 105 events |
| `ff_calendar_thisweek.xml` | **200**, `text/xml` (declared `windows-1252`), 36 406 B, same 105 events, **plus a `url` field** |
| `ff_calendar_thisweek.csv` | **200**, `application/octet-stream`, 12 798 B, same 105 rows, same column set as XML incl. `URL` |
| `ff_calendar_nextweek.json`, `ff_calendar_lastweek.json`, `ff_calendar_today.json`, `ff_calendar_tomorrow.json`, `ff_calendar_thisweek.txt` | **404** (Cloudflare 404 page) |

**There is no next-week or last-week variant.** The only window ever
visible is the current week. Consequences: (a) history exists only because
*we* store it — a week the server misses is a week lost (§3.4, §8); (b) no
look-ahead beyond Saturday.

Response headers that matter for polling (§3.2): served via Cloudflare with
`cache-control: public, max-age=60`, `last-modified`, and a weak `etag`
(`W/"6aaaaac9-36ff"`) — so conditional requests (`If-None-Match`) are cheap
and correct.

### 1.2 Shape

JSON: a bare array; every element has exactly these six keys, no others:

```json
{ "title": "Federal Funds Rate", "country": "USD",
  "date": "2026-09-16T14:00:00-04:00", "impact": "High",
  "forecast": "4.00%", "previous": "3.75%" }
```

| Field | Observed values / semantics |
|---|---|
| `title` | Free text, e.g. `CPI m/m`, `FOMC Press Conference`, `ECB President Lagarde Speaks`. **Not unique**: the same title recurs across countries (`Unemployment Rate` for GBP and CNY) and the same (title, country) can recur within a week (Lagarde spoke Mon and Fri). |
| `country` | ISO currency code: `USD` 26, `EUR` 19, `GBP` 15, `CAD` 13, `CNY` 9, `NZD` 8, `JPY` 8, `AUD` 4, `CHF` 2, and the literal **`All`** (1: "BRICS Summit"). |
| `date` | ISO-8601 **with numeric offset**, `-04:00` this week — i.e. America/New_York wall time (will be `-05:00` after the DST change). Unambiguous instant; `Date.parse` gives the correct UTC ms. Cross-checked against the XML/CSV `time` column, which is the same instant rendered in **UTC** (`8:15am` ↔ `04:15-04:00`). **Store UTC ms from the JSON; do not parse the XML/CSV times as ET.** |
| `impact` | `Low` 78, `Medium` 11, `High` 16 this week. ForexFactory also uses `Holiday` on bank-holiday rows (not present this week) — the parser must accept it and any unknown string. |
| `forecast`, `previous` | **Strings**, empty when absent. Not numerically clean: `3.75%`, `8.3K`, `480B`, `-2.57B`, `3-0-6` (vote split), `<1.25%` (BoJ rate band), `50.6`. Speeches/meetings have both empty. |

**There is no `actual` field — on any record, in any of the three formats.**
Fifty-six of the 105 events had already occurred at fetch time (Sun–Wed,
including Tue's CAD CPI and Mon–Tue UK labour data); none carries a result.
This feed is a *schedule*, not a *results* feed. See §1.3 and D5.

**Week window:** first event `2026-09-13T04:15-04:00` (Sunday), last
`2026-09-19T06:15-04:00` (Saturday) — the feed's week is **Sunday 00:00 →
Saturday 24:00 America/New_York**, ForexFactory's own convention. The
rollover is therefore around 04:00–05:00 UTC Sunday (DST-dependent); the
exact minute is not documented and §3.4 does not depend on it.

**Stable identity:** the JSON has no id. The XML/CSV `url` is
`https://www.forexfactory.com/calendar/<n>-<slug>`, and `<n>` is a
**per-series id** (same number for every occurrence of the same release:
`832` for both Lagarde speeches, `504` for both ECOFIN days; distinct across
countries: `Unemployment Rate` GBP = `58`, CNY = `771`). 103 distinct ids
across 105 rows. CSV/JSON row order was identical in the fetch (verified
positionally on title+country for all 105 rows). §2.2 builds the event key
from this id + the scheduled date, and §3.1 says how to obtain it robustly.

### 1.3 Where results (actuals) can come from — the honest position

1. **Not from this feed** (§1.2). Parsing must tolerate an `actual` key
   appearing in future (map it if present) but nothing may depend on it.
2. **Derivable, with lag, from the feed itself:** when the *next* occurrence
   of series `<n>` appears, its `previous` is the value released at the
   *prior* occurrence (possibly revised). E.g. next month's `CPI m/m` CAD row
   will carry `previous: <this month's actual>`. Lag = one release cycle
   (a week for weekly series, a month for most, ~6 weeks for FOMC). Free,
   no credentials, no scraping. **Built in this design** (§3.5) with an
   explicit provenance flag, because it is the only source that costs
   nothing and keeps the "history" table self-consistent.
3. **Scraping `forexfactory.com` event pages** (the `url`): the pages show
   actuals promptly, but it is HTML scraping against a site whose ToS
   restricts automated access, with Cloudflare in front. **Not designed;
   recommended against** — brittle and a policy risk.
4. **A second provider with actuals** (Trading Economics, FMP, Finnhub,
   EODHD, …): real-time actuals, but all require a key and most a paid tier.
   **Flagged, not assumed** — per this project's rule of asking before
   spending or requesting credentials (base §9.1 escalation pattern). §2.1
   reserves the fields (`actual`, `actualSource`, `actualAt`) and §3.5
   defines an `ActualsSource` port so a provider can be added later as one
   adapter without a schema change.

---

## 2. Decisions at a glance, then the data model

| Decision | Choice | One-line why |
|---|---|---|
| D1 Placement | New Nest module **`calendar`** inside `apps/signal-server`; client feature inside `apps/chart-client`. **No new service.** | Same process already owns polling loops, a WS gateway, storage ports, `BarClock`, health/metrics; a second deployable would duplicate all of it for ~100 rows a week |
| D2 Event identity | `id = ff:<seriesId>:<YYYY-MM-DD>` (series id from the XML `url`, date = scheduled **ET calendar day**); synthetic fallback `ffx:<sha1(title|country|date)>` only when the id cannot be joined | Survives time-of-day revisions within the day (the common revision), distinguishes same-series twice-a-week, is stable across polls and restarts |
| D3 Revisions | One **current** record per id, upserted; every change appended to an **append-only revision log** with the poll timestamp | The user wants history: "what was forecast the night before" is a research question; the current row alone loses it |
| D4 Storage | **`EventStore` port with File + S3 implementations**, JSONL, same layout family as `MetricStore`; in-memory `CalendarCache` is the read path. **No SQLite/RDBMS.** | Justified against the base pattern in §4.1 — the workload is tiny, single-writer, range-by-date, and the S3 bucket/IAM pin already exists; SQLite on Fargate would need EFS or lose data on every deploy |
| D5 Actuals | Nullable `actual` + provenance; **next-occurrence-`previous` backfill built now**; an `ActualsSource` port left for a real provider; scraping rejected | §1.3 |
| D6 Polling | Every **10 min** with `If-None-Match`; **every 2 min** from 20 min before a High-impact event to 20 min after **plus** every 2 min through the Sunday rollover window; clamp: never more than 1 request/min | Catches same-day time/forecast revisions promptly, stays polite to a free CDN-cached feed, and does not pretend to be an actuals poller (there are none to catch) |
| D7 Week roll | The feed is a snapshot of one ET week. Diff **only inside the snapshot's week window**; never delete stored rows; rows that vanish inside the window are marked `status: 'removed'`, not deleted | "Store everything forever" with the only source being a rolling one-week window |
| D8 Notifications | Two triggers, one mechanism: server computes them, persists a ledger, pushes them over the existing WS on a new `calendar` topic; client shows toasts + a notification centre. **Daily digest at 00:00 America/New_York for the ET calendar day** (configurable). Browser `Notification` API as an opt-in client toggle. **No email/SMS/Telegram/mobile push** — needs external credentials; flagged for the user | §5; nothing resembling a notification channel exists today in either app (verified: no push/webhook/email code) |
| D9 UI | A **top-level view switch in the terminal shell** (`charts` ⇄ `calendar`), not a panel kind and not the Angular Router; plus a status-bar "next event" chip and a toast host overlaying either view | A weekly table is not a chart panel and does not share the panel-grid's time-sync; the client has no router today and one boolean of view state does not justify adding one |
| D10 Not now | Event markers on charts, per-user timezones, per-user filters persisted server-side, actuals from a paid provider, strategy access to events | §9 |

### 2.1 Contract (`libs/contracts/src/calendar.ts`, new file)

```ts
export const EventImpactSchema = z.enum(['low', 'medium', 'high', 'holiday', 'unknown']);
export type EventImpact = z.infer<typeof EventImpactSchema>;

/** Currency code as the feed gives it (`USD`, `EUR`, …) or the literal `All`. */
export const EventCountrySchema = z.string().regex(/^[A-Z]{3}$|^All$/);

export const EventStatusSchema = z.enum(['scheduled', 'released', 'removed']);
// scheduled: in the future per the latest snapshot
// released: scheduledAt has passed (set by the scheduler tick, not by the feed — the feed has no such flag)
// removed: was in a snapshot for its week, then disappeared from a later snapshot of the same week (D7)

export const EconomicEventSchema = z.object({
  id: z.string(),                       // D2: 'ff:832:2026-09-14' or 'ffx:<sha1>'
  source: z.literal('forexfactory'),
  seriesId: z.string().nullable(),      // '832' — null only for ffx: ids
  sourceUrl: z.string().url().nullable(),
  title: z.string().min(1),
  country: EventCountrySchema,
  impact: EventImpactSchema,
  scheduledAt: z.number().int(),        // ms UTC, from the JSON `date` (ISO with offset)
  scheduledDay: z.string(),             // 'YYYY-MM-DD' — the ET calendar day of scheduledAt; the feed's own day (§1.2)
  forecast: z.string().nullable(),      // raw string; '' → null
  previous: z.string().nullable(),
  actual: z.string().nullable(),        // D5
  actualSource: z.enum(['feed', 'next-previous', 'provider']).nullable(),
  actualAt: z.number().int().nullable(),// ms UTC when `actual` was set (NOT the release time — we do not know it)
  status: EventStatusSchema,
  firstSeenAt: z.number().int(),        // ms UTC of the poll that created the record
  lastSeenAt: z.number().int(),         // ms UTC of the last poll containing it
  revision: z.number().int().min(1),    // bumps on every field change (§3.3)
});
export type EconomicEvent = z.infer<typeof EconomicEventSchema>;

/** Append-only audit row, one per change (§3.3). */
export const EventRevisionSchema = z.object({
  eventId: z.string(),
  revision: z.number().int(),
  at: z.number().int(),                 // poll time, ms UTC
  change: z.enum(['created', 'updated', 'removed', 'actual']),
  before: EconomicEventSchema.partial().nullable(),   // only the changed fields
  after: EconomicEventSchema.partial(),
});
export type EventRevision = z.infer<typeof EventRevisionSchema>;

export const CalendarNotificationKindSchema = z.enum(['daily-digest', 'event-due']);
export const CalendarNotificationSchema = z.object({
  id: z.string(),                       // 'digest:2026-09-16' | 'due:<scheduledAt ms>' — deterministic, so the ledger dedupes across restarts (§5.4)
  kind: CalendarNotificationKindSchema,
  at: z.number().int(),                 // ms UTC when it fired
  day: z.string().optional(),           // digest: the ET day it covers
  events: z.array(EconomicEventSchema), // digest: the day's events; event-due: every event at that instant (FOMC = 3 rows at 14:00)
  title: z.string(),                    // server-rendered, plain text, ≤ 80 chars, e.g. 'USD · High · Federal Funds Rate (+2)'
});
export type CalendarNotification = z.infer<typeof CalendarNotificationSchema>;

/** Pure, unit-tested helpers exported for both apps. */
export function eventDayNY(scheduledAt: number): string;            // ET calendar day via date-fns-tz, DST-correct
export function eventWeekWindowNY(anyMsInWeek: number): { from: number; to: number }; // Sun 00:00 → Sat 24:00 ET, as ms UTC
export function parseFeedValue(raw: string | null): number | null;  // '3.75%'→3.75, '8.3K'→8300, '480B'→4.8e11, '3-0-6'→null, '<1.25%'→null; research convenience, never used for identity
```

Rules:
- **`scheduledAt` comes from the JSON `date` only** (§1.2). The XML/CSV are
  read for `url` and nothing else.
- **`forecast`/`previous`/`actual` are stored as the feed's strings.**
  Normalising to numbers destroys information (`3-0-6`, `<1.25%`); the
  helper exists for consumers that want numbers.
- `impact` is lower-cased on ingest; unknown strings become `'unknown'` and
  increment a metric, never a throw.
- `scheduledDay` is ET because that is the feed's day and the day the daily
  digest covers (§5.2). All *instants* remain UTC ms like every other
  timestamp in the system (base §3.5).

### 2.2 Identity and revision semantics (D2, D3)

`id = 'ff:' + seriesId + ':' + scheduledDay`.

| What the feed does between polls | What happens to the record |
|---|---|
| Same row, nothing changed | `lastSeenAt` bumps; no revision |
| Time moved within the same ET day (the common case: "Tentative" → fixed, or 8:30 → 10:00) | Same id; `scheduledAt` updated; `revision++`; revision row `updated` with `{before:{scheduledAt}, after:{scheduledAt}}`; any *pending* due-notification is re-keyed (§5.3) |
| Forecast/previous/impact/title changed | Same id; field updated; `revision++`; revision row |
| Time moved to another day | New id appears, old id disappears inside the week window → old marked `removed`, new `created`. Two records, both kept — correct, because a research join on "the day the number came out" needs the real day |
| Row disappears inside its week window (cancelled) | `status: 'removed'`, `revision++`; record kept |
| Row belongs to a past week (aged out of the snapshot) | Untouched — the snapshot no longer speaks about it (D7) |
| Series id could not be joined (§3.1 fallback) | `id = 'ffx:' + sha1(title + '|' + country + '|' + scheduledDay)`, `seriesId: null`. Same revision rules. Metric `calendar_unjoined_rows_total` so a persistent join failure is visible |

---

## 3. Ingestion (`apps/signal-server/src/calendar/`)

```
apps/signal-server/src/calendar/
  calendar.module.ts
  feed/
    ff-feed.client.ts             # fetch JSON + XML with If-None-Match; returns { changed, json, xml, etag, fetchedAt } or { changed: false }
    ff-feed.mapper.ts             # pure: (jsonRows, xmlRows) → EconomicEvent drafts (§3.1); fixtures from the real 2026-09-16 responses
    fixture-feed.client.ts        # reads test/fixtures/calendar/*.json|xml — the ReplayAdapter analogue (base §4.1); selected when MARKET_DATA_MODE=replay
  calendar-cache.service.ts       # in-memory Map<id, EconomicEvent> + sorted index by scheduledAt; loaded from store at boot (§4.3)
  calendar-ingestion.service.ts   # poll loop (§3.2), diff/upsert (§3.3), week roll (§3.4), emits CalendarEventChanged
  actuals-backfill.service.ts     # §3.5 next-previous rule; ActualsSource port
  notification-scheduler.service.ts   # §5
  calendar.events.ts              # CalendarEventChanged { event, change }, CalendarNotificationFired { notification }
```

### 3.1 Mapping one snapshot (pure, in `ff-feed.mapper.ts`)

1. Parse JSON (zod: array of the six-key row; extra keys allowed, so a
   future `actual` is picked up).
2. Parse XML (`fast-xml-parser`, decode as `windows-1252` → the response is
   declared so; Node's `TextDecoder('windows-1252')` handles it) into rows
   `{title, country, date, time, impact, forecast, previous, url}`.
3. **Join JSON row → XML row** to obtain `url`: first by position **if**
   `xml[i].title === json[i].title && xml[i].country === json[i].country`
   (true for all 105 rows on 2026-09-16); otherwise by
   `(title, country, UTC-instant)` where the XML instant is
   `date` (MM-DD-YYYY) + `time` (h:mmam/pm) read as **UTC** (§1.2). If both
   fail, `seriesId: null` and the `ffx:` fallback (§2.2). XML rows with
   `time` values like `All Day` or `Tentative` (seen on other weeks of this
   feed historically; not this week) simply fail the instant match and fall
   through to the positional result, which is why position is tried first.
4. `seriesId` = the `<n>` in `/calendar/<n>-`; `sourceUrl` = the url.
5. `scheduledAt = Date.parse(json.date)`; `scheduledDay = eventDayNY(scheduledAt)`.
6. `''` → `null` for forecast/previous; `impact` lower-cased with fallback.

Fixtures: the three real 2026-09-16 responses are committed under
`test/fixtures/calendar/2026-09-16/` and are the mapper's golden test (105
rows, 103 series ids, two doubled ids, one `All` row, offset `-04:00`).

### 3.2 Poll loop (`calendar-ingestion.service.ts`)

Rides the existing `BarClock` 1-minute tick (base §4.6), like
`MetricIngestionService` — no second timer. On each tick decide whether to
poll:

| Condition | Cadence |
|---|---|
| Default | every `CALENDAR_POLL_INTERVAL_MS` (default **600 000** = 10 min) |
| Any `impact: 'high'` event with `scheduledAt` within **[now − 20 min, now + 20 min]** | every `CALENDAR_POLL_HOT_INTERVAL_MS` (default **120 000**) |
| Sunday **03:00–07:00 UTC** (covers the ET-midnight rollover under both DST states) | every `CALENDAR_POLL_HOT_INTERVAL_MS` |
| Hard floor | never two requests < 60 s apart (the CDN caches 60 s anyway) |

Each poll: `GET …json` and `GET …xml` with `If-None-Match: <last etag>` per
URL. A `304` on the JSON = nothing to do (metric `calendar_polls_total{result="not-modified"}`).
A non-2xx/304 or a parse failure logs at `warn`, increments
`calendar_poll_errors_total`, keeps the cache as is, and backs off
exponentially to max 30 min — the calendar is not on the signal path; a
stale calendar is degraded, not fatal (`/api/health` §8).

**Why not tighter around events:** the only thing a tighter poll could
catch is a time/forecast edit minutes before release, which the 2-minute hot
window already covers. There are no actuals to race for (§1.2). Polling a
free feed every 15 s for no data would be discourteous and pointless.

### 3.3 Diff and upsert

```
snapshot = mapper(json, xml)                       // drafts keyed by id
window   = eventWeekWindowNY(min(snapshot.scheduledAt))   // Sun 00:00 → Sat 24:00 ET
current  = cache.inWindow(window)                  // stored events whose scheduledAt ∈ window and status ≠ 'removed'

for draft in snapshot:
  existing = cache.get(draft.id)
  if !existing:            create (status 'scheduled' or 'released' by time), revision 1, revision row 'created'
  else if changed(fields): apply, revision++, revision row 'updated' (only diffed fields in before/after)
  else:                    lastSeenAt = now
for ev in current not in snapshot:   status 'removed', revision++, revision row 'removed'

store.upsert(changedEvents); store.appendRevisions(rows); emit CalendarEventChanged per change
```

`changed(fields)` compares `title, country, impact, scheduledAt, forecast,
previous` (and `actual` if the feed ever supplies it). Everything goes through
`EventStore.upsert` (idempotent on `id`) so a crash between poll and flush
is harmless — the next poll re-derives the same result.

### 3.4 Week roll — how history accumulates without gaps or duplicates (D7)

The invariant: **the diff is scoped to the snapshot's own week window**
(§3.3 `window`). When the feed rolls to the next week the snapshot's minimum
date jumps to the new Sunday, `window` moves with it, and last week's rows —
now outside `window` — are simply no longer compared, so they are neither
"removed" nor touched. They stay in the store with whatever `status` the
scheduler gave them (`released`, §5.3). Nothing is ever deleted.

Duplicates are impossible by construction: ids are deterministic (D2), and
`upsert` is keyed on id.

**Gap risk, stated:** if the server is down across an entire Sunday→Sunday,
that week's schedule is never seen and cannot be recovered from this source
(no `lastweek` endpoint, §1.1). Mitigations: (a) `/api/health` and a
`calendar_last_successful_poll_age_seconds` gauge with an alarm threshold of
2 h (§8), (b) boot immediately polls before anything else, (c) the
next-previous backfill (§3.5) will still recover the *actual* of a missed
release when the series recurs, but not its scheduled time/forecast.
Recovering a missed week from a second source is out of scope (D10).

### 3.5 Actuals (D5) — `actuals-backfill.service.ts`

```ts
interface ActualsSource {            // port; ACTUALS_SOURCES multi-provider token
  readonly id: 'next-previous' | string;
  /** Called after every ingestion diff; returns actual values it can now assert. */
  resolve(changed: EconomicEvent[], lookup: (seriesId: string) => EconomicEvent[]): Promise<Array<{ eventId: string; actual: string }>>;
}
```

**`NextPreviousActualsSource`** (built now): for every created/updated event
`e` with `seriesId` and non-null `previous`, find the latest stored event
`p` of the same `seriesId` with `p.scheduledAt < e.scheduledAt` and
`p.status !== 'removed'`. If `p.actual` is null **or**
`p.actualSource === 'next-previous'` and the value differs (a revision), set
`p.actual = e.previous`, `p.actualSource = 'next-previous'`,
`p.actualAt = now`, `p.revision++`, revision row `actual`, emit
`CalendarEventChanged{change:'actual'}`. Never overwrite an `actual` whose
source is `'feed'` or `'provider'`.

Caveats to record in the service header comment: (1) `previous` may already
be the *revised* number, not the first print — research that cares about
the surprise-at-release must treat `next-previous` actuals as "latest
revision", not "initial"; (2) events without numeric releases (speeches)
never get an actual; (3) latency = one release cycle.

A provider-backed source (§1.3 item 4) would be a second class behind the
same token, setting `actualSource: 'provider'`. Not built; needs a user
decision on the provider and its key.

---

## 4. Storage

### 4.1 Why the File/S3 JSONL pattern and not SQLite (D4)

The brief asks for an explicit justification either way. Requirements:

| Aspect | Need |
|---|---|
| Volume | ~100–150 events/week → ~7 000/year; ≤ 400 B each → **< 3 MB/year** current rows; revisions maybe 3× that |
| Writes | Single writer; a few dozen upserts per poll at most; append-only revision log; notification ledger append |
| Reads | (a) boot: load the last N days (default 400) into memory; (b) range by `scheduledAt` for the week view and history queries; (c) by `seriesId` for the backfill (served from memory); (d) research bulk export |
| Durability | Beyond process/host; survives redeploy; exportable to the Python side |

A relational store would buy indexed ad-hoc queries the server does not
need — every read is served from `CalendarCache` (all of the last ~year in
memory is a few MB). What it would *cost*: **SQLite on ECS Fargate has no
durable disk** (the infra pin is a single Fargate task with S3 as the only
persistent store, `live-signal-server-infra.md` §1–2) — it would need EFS
or a periodic dump-to-S3, i.e. the S3 store anyway plus a second mechanism;
RDS is an always-on instance for a 3 MB/year table (rejected on the same
grounds as base §6.2's Postgres verdict). The S3 bucket, IAM policy and
`aws s3 sync` research-export path already exist and are scoped to
prefixes; adding a `calendar/` prefix is zero infra work. Hive-style keys
keep Athena available if anyone ever wants SQL over it.

So: **follow the pattern.** Verdict holds until a real multi-writer or
ad-hoc-query need appears (none is foreseeable for a calendar).

### 4.2 `EventStore` port (`storage/event-store.port.ts`)

```ts
export interface EventStore {
  upsert(events: EconomicEvent[]): Promise<void>;                          // idempotent on id
  queryByScheduled(from: number, to: number): Promise<EconomicEvent[]>;     // ascending by scheduledAt; all statuses
  get(id: string): Promise<EconomicEvent | null>;
  appendRevisions(rows: EventRevision[]): Promise<void>;
  queryRevisions(eventId: string): Promise<EventRevision[]>;               // ascending by revision
  appendNotifications(rows: CalendarNotification[]): Promise<void>;        // §5.4 ledger
  queryNotifications(from: number, to: number): Promise<CalendarNotification[]>;
}
export const EVENT_STORE = Symbol('EVENT_STORE');
```

### 4.3 Layout (file and S3 identical, gzip on S3 per base §6.4)

```
calendar/events/date=<scheduledDay ET>.jsonl          # current state; one line per event; rewritten whole on upsert (≤ ~40 rows/day)
calendar/revisions/date=<poll UTC day>.jsonl          # append-only
calendar/notifications/date=<fired UTC day>.jsonl     # append-only ledger
calendar/index.json                                   # { eventDay: [ids] } is NOT needed — see below
```

- The `events` partition key is **`scheduledDay`** (ET), not the poll day,
  so "all events on 2026-09-16" is one object and a research join by day is
  a directory listing. `upsert` groups by day, reads the day object, merges
  by id, rewrites — the `FileMetricStore` shape exactly
  (`storage/file/file-metric-store.ts`). An event whose `scheduledDay`
  changes is a *different id* (D2), so no cross-object move is ever needed.
- `get(id)` = parse the day from the id (`ff:<n>:<day>`; for `ffx:` ids the
  cache answers, and a cold `get` on an `ffx:` id falls back to scanning the
  requested range — acceptable, they are rare and the API caller always has
  a range).
- `queryRevisions(eventId)` scans revision objects from the event's
  `firstSeenAt` day to its `lastSeenAt` day (plus 60 days for `actual`
  rows); revisions are small and this is a detail-view read.
- **Boot:** `CalendarCache` loads `queryByScheduled(now − 400 d, now + 14 d)`
  (env `CALENDAR_CACHE_LOOKBACK_DAYS`, default 400 — a year plus, so
  `next-previous` backfill finds prior occurrences for monthly and
  quarterly series). Older history is served from the store on request.

`StorageModule` gains a fourth factory (`EVENT_STORE`, `FileEventStore` /
`S3EventStore`, same `CANDLE_STORE=file|s3` switch and the same
`S3Client` — SE should extract the repeated `S3Client` construction in
`storage.module.ts` into one helper while adding the fourth copy).
Notification-ledger writes and revision appends are small and infrequent;
they go straight to the store (no write buffer). Event upserts go through a
tiny debounce (flush at most once per poll) — in practice the poll *is* the
batch.

### 4.4 Retention

Everything under `calendar/` is **retained indefinitely** (the point of R5).
DevOps: add `calendar/` to the same "excluded from the 90-day derived-data
expiry" rule as `1m` candles (infra note §1) — one lifecycle-rule edit, no
new bucket, no new IAM.

---

## 5. Notifications

### 5.1 Mechanism (D8)

Verified: neither app has any notification, alerting, email, webhook or
push code (`grep -ri "notif\|toast\|webhook\|email\|telegram\|push"` across
both `src` trees → nothing). The cheapest channel that fits the system is
the one it already has: **server decides, WebSocket delivers, client
renders.** Concretely:

- The server's `NotificationScheduler` computes both triggers (§5.2, §5.3),
  writes each fired notification to the ledger (§5.4), emits
  `CalendarNotificationFired`, and the gateway pushes
  `{ type: 'notification', notification }` to every client subscribed to the
  `calendar` topic (§6.2).
- The client shows a **toast** (auto-dismiss 15 s for `event-due`, sticky
  until dismissed for `daily-digest`) and appends to a **notification
  centre** (bell icon in the top bar with an unread count; the last 50,
  seeded from `GET /api/calendar/notifications` on boot so a client that
  was closed still sees today's digest).
- **Browser `Notification` API** (OS-level desktop notification while the
  tab is in the background): an opt-in toggle in the notification centre
  ("Desktop notifications"), stored in `localStorage`; no server involvement,
  no external service, no credentials. Off by default because it prompts
  for permission.
- **Anything external** — email, SMS, Telegram, mobile push (FCM/APNs),
  Slack — requires a provider, an account and secrets in Secrets Manager.
  **Not designed.** If the user wants to be notified when the terminal is
  closed, that is the next decision to put to them; the server-side shape
  is ready for it (a `NotificationSink` multi-provider token beside the WS
  sink, one adapter per channel), so it is additive.

### 5.2 Daily digest

- **When:** `CALENDAR_DIGEST_TIME` (default `00:00`) in
  `CALENDAR_DIGEST_TZ` (default `America/New_York`). Rationale: the feed's
  day *is* the ET day (§1.2), so "today's events" has a crisp meaning; ET
  midnight is 06:00 in Warsaw, i.e. a morning digest for the user, and it
  precedes the European, London and New York sessions of that ET day while
  the Asia-Pacific releases of the same ET day (which fall 18:00–24:00 ET
  the *previous* evening by wall clock — NZ GDP at 18:45 ET) are in the
  *previous* digest, which is also when a Europe-based reader would want
  them. This matches the project's NY-anchored session framing
  (`knowledge/vwap-band-reversal-ict.md` §1, §8) rather than inventing a UTC
  day. There is **no per-user timezone concept** anywhere in the system
  (verified) and this note does not add one.
- **What:** all events with `scheduledDay === thatDay` and `status !==
  'removed'`, filtered by `CALENDAR_NOTIFY_MIN_IMPACT` (default `low`, i.e.
  everything) and `CALENDAR_NOTIFY_COUNTRIES` (default empty = all). Sorted
  by `scheduledAt`. `title` = `Today: 18 events · 4 high (USD, GBP)`.
- **Also fires** on boot if today's digest is not in the ledger and the
  digest time for today has already passed (so a restart at 09:00 ET still
  produces the day's digest once).
- Empty day (Saturday): fire a digest with zero events and title `Today: no
  scheduled events` — the absence of a digest must not be ambiguous with a
  broken scheduler.

### 5.3 At-event-time

- On every `BarClock` tick `t` (minute boundary + jitter, base §4.6): fire
  for every event with `status === 'scheduled'`, `t − 60 000 < scheduledAt ≤
  t`, passing the impact/country filters. Events sharing the same
  `scheduledAt` are **one** notification (`id = 'due:' + scheduledAt`, e.g.
  FOMC's three 14:00 rows → title `USD · High · Federal Funds Rate (+2)`).
  Then set those events' `status = 'released'` (revision row, persisted) —
  this is the only place `released` is set.
- Catch-up: if the process was down and a tick sees events with
  `scheduledAt` older than `t − 60 000` still `scheduled`, mark them
  `released` **without** notifying if older than
  `CALENDAR_DUE_CATCHUP_MS` (default 15 min), else notify (a late toast is
  better than none within a quarter hour; an hour-old toast is noise).
- Time revisions (§2.2): nothing to re-key — the scheduler reads the
  event's current `scheduledAt` at each tick. If an event is moved *earlier*
  than now by a revision, the catch-up rule applies.
- No pre-alert ("5 minutes before") is designed; the user asked for
  at-the-moment. If wanted later it is one more `kind` and one config
  value, no structural change.

### 5.4 Ledger and idempotency

Notification ids are deterministic (`digest:<day>`, `due:<ms>`). Before
firing, the scheduler checks the in-memory set of fired ids, seeded at boot
from `queryNotifications(now − 2 d, now)`. Fire → append to ledger → emit.
A crash between append and emit loses one WS push, never duplicates one.

---

## 6. API surface

### 6.1 REST (`api/rest/calendar.controller.ts`; all times ms UTC; zod DTOs in `wire.ts`)

| Method / path | Returns |
|---|---|
| `GET /api/calendar/events?from&to&country?&impact?&status?&limit?` | `EconomicEvent[]` ascending by `scheduledAt`. `from/to` required (ms). `country` repeatable; `impact` = minimum level (`low|medium|high`); `status` default excludes `removed`. `limit` default 2000, max 10 000. Served from `CalendarCache` when the range is inside the cache window, else `EventStore.queryByScheduled`. |
| `GET /api/calendar/week?at?` | `{ from, to, day: string[7], events: EconomicEvent[] }` — the ET Sun–Sat window containing `at` (default now), convenience for the weekly view; `day[i]` are the seven `scheduledDay` strings so the client can group without re-deriving ET days |
| `GET /api/calendar/events/:id` | `{ event: EconomicEvent, revisions: EventRevision[] }` — forecast/previous/actual with provenance, plus the full change history |
| `GET /api/calendar/notifications?from?&to?&limit?` | `CalendarNotification[]` descending by `at`; default last 48 h, limit 50 |
| `GET /api/calendar/status` | `{ lastPollAt, lastSuccessAt, lastEtag, weekWindow: {from,to}, eventsInWindow, nextPollAt, hot: boolean }` |
| `GET /api/health` | gains `calendar: { lastSuccessfulPollAge: number \| null, eventsInWindow: number }` (additive, like `metrics` was) |

Filtering by `seriesId` (`GET /api/calendar/events?seriesId=832&from&to`) is
included in the first endpoint's query schema — that is the "history of one
release" view research will want first.

### 6.2 WebSocket (existing socket, one new topic; additive to `wire.ts`)

| Client → server | Server → client |
|---|---|
| `{ type: 'subscribe', topic: 'calendar' }` (no parameters — one stream for the whole calendar; volume is a few frames per hour) | `{ type: 'calendarEvent', event: EconomicEvent, change: 'created' \| 'updated' \| 'removed' \| 'actual' }` |
| `{ type: 'unsubscribe', topic: 'calendar' }` | `{ type: 'notification', notification: CalendarNotification }` |

Yes, event updates push over WS (the brief's question): the week view
should reflect a time revision or an actual landing without a reload, and
the client already has the subscribe/reconnect/heal plumbing. On
`reconnected$` the calendar store re-fetches `GET /api/calendar/week` and
`GET /api/calendar/notifications?from=<lastSeen>` — same "never assume
nothing was missed" rule as candles (base §5.3 step 5).

Gateway changes: `ClientState` gains `calendar: boolean`; two new
`@OnEvent` handlers fan `CalendarEventChanged` / `CalendarNotificationFired`
to subscribed clients; `WsClientMessageSchema`'s subscribe/unsubscribe
unions gain the `calendar` topic; `WsServerMessageSchema` gains the two
frames. No throttle needed.

---

## 7. Client (`apps/chart-client`)

### 7.1 Placement (D9)

The shell today is `top-bar / body(<app-panel-grid>) / status-bar`
(`terminal-shell.component.ts`), no router (`app.config.ts` has only the
error listener). A weekly calendar is a full-width table that has nothing
to do with the panel grid's time-range sync or timeframe, so it is neither
a `Panel.kind` (would drag `PanelFeed`/`ChartSyncService` into a table) nor
a side panel (too narrow for seven days × ~20 rows). It is a **second body
view**:

```
apps/chart-client/src/app/
  core/
    api/rest.client.ts                  # + fetchCalendarWeek, fetchCalendarEvents, fetchCalendarEvent, fetchCalendarNotifications
    api/live.socket.ts                  # + 'calendar' topic key, calendarEventFrames$, notificationFrames$
    contracts/derived.ts                # + WsCalendarEventFrame, WsNotificationFrame
    state/view.store.ts                 # NEW  activeView: signal<'charts' | 'calendar'>; localStorage 'chart-client:active-view'
    state/calendar.store.ts             # NEW  week window + Map<id, EconomicEvent>; merge rule: same id → replace if incoming.revision ≥ stored.revision
    state/notifications.store.ts        # NEW  last 50 CalendarNotification, unread count, toast queue; desktop-notification opt-in flag
  features/
    terminal/terminal-shell.component.ts   # top bar: + <app-view-switcher> (Charts | Calendar) + <app-notification-bell>; body: @switch on view; + <app-toast-host> overlay; shortcut `c` toggles view
    view-switcher/…                     # NEW  two-button segmented control
    calendar/
      calendar-week.component.ts        # NEW  seven day columns (or stacked days on narrow widths); header shows ET week range; prev/next week arrows → GET /api/calendar/events for past weeks (history)
      calendar-day.component.ts         # NEW  rows sorted by scheduledAt; "now" line; released rows dimmed; removed rows struck through (toggle to hide)
      calendar-event-row.component.ts   # NEW  time (local browser tz, with ET in the tooltip) · country · impact dot · title · forecast · previous · actual (with a provenance glyph: ○ pending, ◐ next-previous, ● feed/provider)
      calendar-filters.component.ts     # NEW  impact ≥ / country multiselect / hide removed; persisted in localStorage 'chart-client:calendar-filters'
      calendar-event-detail.component.ts# NEW  drawer on row click: GET /api/calendar/events/:id → revisions timeline
    notifications/
      notification-bell.component.ts    # NEW  unread badge; opens the centre
      notification-center.component.ts  # NEW  list of last 50; "Desktop notifications" toggle (Notification.requestPermission on enable)
      toast-host.component.ts           # NEW  fixed bottom-right stack; event-due auto-dismiss 15 s; digest sticky; click → switch to calendar view, scroll to the event
    status-bar/status-bar.component.ts  # + "next: 14:00 USD FOMC (in 42m)" chip from calendar.store (nearest future high/medium event)
```

- **Panel-grid feeds keep running while the calendar view is shown** (they
  are cheap and switching back must be instant). The calendar topic is
  subscribed once at boot regardless of view, because notifications must
  arrive on the charts view too.
- Times render in the **browser's local zone** (that is what a person
  expects from a calendar), with the ET time in a tooltip since that is
  what the feed and every news site show. Day grouping uses `scheduledDay`
  (ET) from the server, so the columns are the feed's days, not local days —
  the header says so ("days are New York days").
- No new dependency for the table; plain Angular control flow and CSS grid
  in the existing dark terminal style.

### 7.2 Mock server

`apps/chart-client/mock-server/` gains `GET /api/calendar/*` from the
committed 2026-09-16 fixture (re-dated to "this week" at startup so the
"now" line lands mid-week) and a synthetic `notification` frame every few
minutes, so SE-CAL-2 builds and e2e-tests without the server unit (the
SE-2/SE-5 precedent).

---

## 8. Observability and configuration

**Env (`env.schema.ts`, additive):**

```
CALENDAR_ENABLED=true
CALENDAR_FEED_BASE_URL=https://nfs.faireconomy.media/ff_calendar_thisweek   # .json/.xml appended
CALENDAR_POLL_INTERVAL_MS=600000
CALENDAR_POLL_HOT_INTERVAL_MS=120000
CALENDAR_CACHE_LOOKBACK_DAYS=400
CALENDAR_DIGEST_TIME=00:00
CALENDAR_DIGEST_TZ=America/New_York
CALENDAR_NOTIFY_MIN_IMPACT=low            # low|medium|high
CALENDAR_NOTIFY_COUNTRIES=                # empty = all; else 'USD,EUR,GBP'
CALENDAR_DUE_CATCHUP_MS=900000
```

In `MARKET_DATA_MODE=replay` the `FixtureFeedClient` is bound; the scheduler
still runs on real time (so a dev can see toasts by editing the fixture's
dates).

**Metrics (`/metrics`):** `calendar_polls_total{result}`,
`calendar_poll_errors_total`, `calendar_last_successful_poll_age_seconds`,
`calendar_events_in_window`, `calendar_event_changes_total{change}`,
`calendar_unjoined_rows_total`, `calendar_notifications_total{kind}`.
**Alarm (DevOps, optional):** `calendar_last_successful_poll_age_seconds >
7200`. **Logs:** one pino line per poll with `{etag, changed, created,
updated, removed}` and one per notification.

---

## 9. Deliberately not designed here

- **Event markers on the chart panels** (vertical lines at high-impact
  times). Natural next step; would be a client-only feature over the
  `calendar` topic and the existing overlay vocabulary. Not asked for.
- **Strategy access to events** (`StrategyContext.events`). That is the
  backlog idea's territory and a strategy-engine change; explicitly out of
  scope per the brief.
- **Actuals from a paid/keyed provider** — user decision (§1.3).
- **External notification channels** — user decision (§5.1).
- **Per-user timezone / server-side saved filters / multi-user** — no user
  model exists (base §4.5 "single-user, private").
- **Recovering a missed week from another source** (§3.4).

---

## 10. Routing plan — Software Engineer, two units

Not self-dispatching (multi-module, one user-facing decision pending on
actuals); the coordinator dispatches. The contract (§2.1, §6) is fixed here
so the two units run **in parallel**, the way SE-1/SE-2 and SE-4/SE-5 did.

### SE-CAL-1 — contracts + server (`libs/contracts`, `apps/signal-server`)

1. `libs/contracts/src/calendar.ts` (§2.1 incl. the three helpers with unit
   tests: DST boundary for `eventDayNY`, week window on both sides of the
   November change, `parseFeedValue` on the exact strings in §1.2);
   `wire.ts` additions (§6.1 query/response schemas, §6.2 frames/topic);
   `index.ts` exports.
2. Fixtures: commit the three 2026-09-16 responses under
   `apps/signal-server/test/fixtures/calendar/2026-09-16/`.
3. `calendar/feed/*` (§3.1): client with ETag, mapper with the golden test
   (105 rows → 105 events, 103 series ids, ids `ff:832:2026-09-14` and
   `ff:832:2026-09-18` both present, `ff:504:…` likewise, `All` row
   accepted, `scheduledAt` for `Federal Funds Rate` = `2026-09-16T18:00:00Z`).
4. `storage/event-store.port.ts`, `file/file-event-store.ts`,
   `s3/s3-event-store.ts` (§4.2–4.3); fourth factory in `StorageModule`
   with the `S3Client` construction de-duplicated; round-trip + idempotency
   tests; S3 impl against `aws-sdk-client-mock` like the others.
5. `calendar-cache.service.ts`, `calendar-ingestion.service.ts` (§3.2–3.4)
   with tests: diff on two consecutive fixtures (create/update/remove),
   week-roll test (snapshot A = week N, snapshot B = week N+1 → nothing in
   week N touched), hot-window cadence, backoff on 5xx, 304 handling.
6. `actuals-backfill.service.ts` (§3.5) with a test: two fixtures of the
   same series a month apart → the earlier event's `actual` equals the
   later's `previous`, provenance `next-previous`; a `feed`-sourced actual is
   never overwritten.
7. `notification-scheduler.service.ts` (§5) with fake-clock tests: digest
   fires once per ET day incl. the boot catch-up; three same-instant events
   → one `event-due`; catch-up threshold; ledger dedupe across a simulated
   restart.
8. `api/rest/calendar.controller.ts` (§6.1), gateway topic + frames (§6.2),
   `/api/health.calendar`, metrics, env schema, README + `docker-compose`
   env, `CALENDAR_ENABLED=false` cleanly disables the module (no poll, no
   endpoints 404 → return `503 calendar disabled`).

### SE-CAL-2 — client (`apps/chart-client`)

Everything in §7 against the extended mock server (§7.2). Tests that must
exist: `calendar.store` merge by revision; `notifications.store` unread /
toast queue; `view.store` restore; `LiveSocket` calendar topic survives
reconnect (extend the existing fake-socket spec); one Playwright e2e: boot
on charts view, receive a synthetic `notification` frame → toast visible →
click → calendar view with the row highlighted; `c` toggles views; filters
persist across reload.

**Escalation pre-answers (base §9.1 rule):** (a) if the live feed's XML/JSON
row order ever diverges, the instant-join fallback is the design, not a
reason to stop; (b) if the feed starts returning an `actual` key, map it
with `actualSource: 'feed'` — the schema already allows it; (c) do **not**
add a scraper or a third-party actuals API on your own initiative — that is
the user's decision (§1.3).

**Hand-off after build:** coordinator/Architect review, then a user session
with two questions: (1) do they want real-time actuals badly enough to pick
and pay for a provider; (2) do they want notifications outside the terminal
(which channel).

### Not engaged

- **DevOps:** one lifecycle-rule edit (§4.4) and an optional alarm (§8);
  no new resources.
- **Researcher / Backtesting / Integration Engineer:** nothing here is a
  strategy. The backlog entry stays "not prioritized"; this note only makes
  it cheaper to run when it is.

---

## 11. Logging decision

Infrastructure, not a trading idea: **no `IDEAS-BACKLOG.md` entry, no
`RESEARCH-LOG.md` Запись** (base §10, layouts §10). Recorded as a row in
`PROJECT.md`'s Architecture table and a line in its Status section, done
alongside this note. A one-line cross-reference is added to the backlog's
"Scheduled-macro-event reaction" entry pointing at this note as the future
source of the event table — that is an annotation on an existing entry, not
a new one.

---

## 11. Amendment 2026-09-18 — filter defaults, settings, flags, sound

**Role:** Architect. **Status:** design, routed as SE-C (see
[`four-streams-2026-09-18.md`](four-streams-2026-09-18.md)). Client-only: no contract, server
or wire change. New/changed components follow `AGENTS.md` (separate `.html`/`.scss`).

### 11.1 What already exists (checked, 2026-09-18)

- `CalendarFiltersStore` (`core/state/calendar-filters.store.ts`): `minImpact`, `countries`
  (empty = all), `hideRemoved`, persisted under `chart-client:calendar-filters`; defaults
  `{ minImpact: 'low', countries: [], hideRemoved: false }` inline in the store.
- `CalendarFiltersComponent`: an `Impact ≥` select (`low|medium|high`), a country checkbox
  list built from the countries present in the loaded week, a hide-removed box.
- `passesFilters` ranks impact on the ladder `['low','medium','high','holiday','unknown']` —
  so **today `minImpact: 'medium'` already lets `holiday` and `unknown` through**, by
  accident of array order, and there is no way to show medium+high *without* holidays or
  vice versa. That ladder is the defect.
- Filters apply to the week view only. Toasts (`NotificationsStore.receive`) are unfiltered
  client-side; the server filters notifications with its own env (`CALENDAR_NOTIFY_*`,
  default: everything).
- Nothing plays sound; there is no pre-event alert of any kind (§5.3 explicitly left it out).

### 11.2 Impact is a set, not a threshold (decision)

The feed's `impact` values are `Low | Medium | High | Holiday` (+ anything unknown, mapped to
`'unknown'`) — §1.2, and `EventImpactSchema` already has exactly
`low|medium|high|holiday|unknown`. `Holiday` is a **kind of row** (a bank holiday for a
currency), not a rung above High. So:

```ts
// core/state/calendar-settings.defaults.ts — THE one named place for defaults
export const CALENDAR_DEFAULTS = {
  impacts: ['medium', 'high', 'holiday'] as EventImpact[],
  countries: ['USD', 'EUR', 'GBP'],   // currency codes as the feed gives them
  hideRemoved: false,
  alert: { enabled: false, leadMinutes: 5 },
} as const;
```

- `CalendarFilters` becomes `{ impacts: EventImpact[]; countries: string[]; hideRemoved }`.
  `passesFilters`: `impacts.includes(event.impact)`; country rule below. `unknown` is a
  selectable chip, off by default.
- **`countries` is an explicit list; empty means none, not all** — the old "empty = all"
  sentinel cannot coexist with a non-empty default and made "Select all" ambiguous. The UI
  offers All / None / Defaults buttons.
- **`country: 'All'`** (e.g. "BRICS Summit") passes whenever *any* country is selected — it
  is by definition about every currency.
- **Storage key bumps to `chart-client:calendar-filters:v2`** and the old key is removed
  once read-and-ignored. The old stored value is almost certainly the old default
  (everything), and the user's request *is* to change what they see; migrating it would
  silently keep hiding the new defaults. Stated in the PR.

### 11.3 A settings surface, not constants (the user's explicit requirement)

The filter bar above the week becomes the settings surface, always visible on the calendar
view, and every change persists immediately:

- **Impact:** four toggle chips `Medium · High · Holiday · Low` (+ `Unknown`), each
  on/off — replaces the `Impact ≥` select.
- **Currencies:** a checkbox per currency the feed can emit — the fixed list `USD EUR GBP
  JPY CAD AUD NZD CHF CNY` **plus** any other code seen in the loaded week (the current
  list only shows codes present this week, so a default like GBP could vanish from the UI in
  a week with no GBP events and become impossible to untick). Each with its flag (§11.4).
- **Reset to defaults** button — restores `CALENDAR_DEFAULTS` (filters and alert settings).
- **Toasts respect the filters too:** an `event-due` toast is shown only if at least one
  of its events passes; the digest toast lists only passing events (and says "N hidden by
  filters"). The notification centre keeps the full list. The server's env filters are
  untouched.

### 11.4 Flags from currency (decision)

Mapping lives in one pure file `features/calendar/currency-flag.ts` (+ spec):
`currencyFlag(code): { emoji: string | null; label: string }`, built from an ISO
3166 region per currency, turned into regional-indicator emoji at runtime
(`'US'` → U+1F1FA U+1F1F8), not hand-typed glyphs.

| Currency | Region | Shown |
|---|---|---|
| USD | US | 🇺🇸 |
| EUR | **EU** — the EU flag has its own regional-indicator pair and renders on macOS; it is the honest symbol for a currency of 20 states | 🇪🇺 |
| GBP JPY CAD AUD NZD CHF CNY | GB JP CA AU NZ CH CN | national flag |
| `All` | none | 🌐 |
| anything else | none | no emoji — the currency code alone |

- The currency code is **always shown next to the flag**; the flag is decoration, never the
  only identifier. That is also the fallback: platforms without flag-emoji fonts (Windows
  Chrome/Edge render `🇺🇸` as the letters "US") degrade to letters + code, still correct —
  no image assets, no CSP change. macOS (the user's platform) renders them natively.
- Shown on every event row, in the event detail drawer, in toasts, and on the filter chips.

### 11.5 Audible pre-event alert

| Question | Decision |
|---|---|
| How far ahead | Setting `leadMinutes` ∈ {1, 2, 5, 10, 15, 30}, default **5**. One alert per event, at `scheduledAt − lead`. |
| Which events | Those passing the current calendar filters (§11.2), `status === 'scheduled'`. One setting set governs both what you see and what rings — no second filter to keep in sync. |
| Grouping | Events sharing a `scheduledAt` ring **once** (FOMC's three 14:00 rows = one alert), same rule as `due:` notifications (§5.3). |
| Once only | Fired keys `alert:<scheduledAt>` kept in `localStorage['chart-client:calendar-alerts-fired']`, pruned to the last 48 h — a reload never re-rings. A time revision (new `scheduledAt`) is a new key, so a moved event rings again at its new time. The key is the instant only, not the passing event ids: changing the filters inside the lead window never re-rings that instant (and an event that starts passing after its instant already rang does not ring on its own). Two open tabs will both ring — accepted. |
| Late / missed | Fires if `now ∈ [scheduledAt − lead, scheduledAt + 60 s]`; after that it is dropped silently (an alert after the event is noise). |
| Sound | **Generated with Web Audio** — two short sine beeps (880 Hz, 150 ms each, 120 ms apart, gentle attack/release, gain 0.2). No asset, no network, no CSP consideration. |
| Also | A toast `In 5 min: 🇺🇸 USD · High · CPI m/m (+1)`, and, if the existing "Desktop notifications" opt-in is on, an OS notification — so it is seen, not only heard. |
| Background tab | Timers are throttled in background tabs (≈1/min in Chrome after 5 min hidden), so the check runs every 15 s and an alert can be up to ~1 min late in a long-hidden tab; an already-running `AudioContext` does play from a background tab. Documented in the settings tooltip. |

**Autoplay — the arm affordance (required).** Browsers keep an `AudioContext` suspended
until a user gesture. So:

- The setting is a **"Sound alerts" toggle** in the calendar filter bar **and** in the
  notification centre. Turning it on is itself a click: create/resume the `AudioContext`
  and play the chime once as confirmation.
- The preference persists, but after a reload the context is suspended again. While the
  preference is on and the context is not `running`, the top-bar bell shows a **muted
  badge** ("Sound alerts need one click to arm") and the first `pointerdown`/`keydown`
  anywhere on the page resumes the context (one-shot document listener). It is never
  silently broken: armed/unarmed is always visible.
- A "Test sound" button next to the toggle.

**Where it lives:** `core/state/event-alarm.service.ts` (root; scheduling + fired ledger,
pure `dueAlerts(events, filters, leadMs, now, fired)` in its own file with a spec) and
`core/audio/chime.ts` (the only Web Audio code, injectable so specs use a fake). **It must
not read `CalendarStore`**: that store is replaced wholesale when the user browses to
another week (`CalendarFeedService.loadWeek`), which would silently disarm every upcoming
alert. The alarm keeps its own upcoming-events set, seeded by `CalendarFeedService.boot()`
and `healAfterReconnect()` from the *current* week fetch and merged from
`calendarEventFrames$` (the live WS frames). No new polling of our server or any venue.

### 11.6 Tests that must exist

`passesFilters` with the set model (holiday alone, medium+high without holiday, `All`,
unknown), storage v2 read + old-key discard, `CALENDAR_DEFAULTS` applied on empty storage,
reset-to-defaults, `currencyFlag` for every row of §11.4, `dueAlerts` (lead window, grouping,
fired dedupe, revision re-arm, late drop), alarm independent of week navigation, toast
filtering. All existing client tests stay green.
