# What the box stores — owner ruling 2026-11-02, applied (2026-11-03)

**Author:** Architect (insight-bot stream) · **Input:** owner, via the coordinator
(`reports/coordinator-storage-and-image-2026-11-02.md` §2): «на сервере хранить только кеш; писать
сбор level2 данных в базу (liquidation, OI, calendar ...)», and the Tech Lead's request
(`reports/tl-to-architect-storage-ruling.md`). · **Amends:** `member-access-design-2026-10-31.md` §3
(which dropped the OI/LS poller). · **Output:** WD-006/010/011/012/016 revised, IB-080, IB-081, an
IB-077 note.

## 1. The rule

The box writes to Postgres only what a venue forgets. Everything else is read on demand and held
in WD-008's `TtlCache`.

| Data | Where it lives | Why |
|---|---|---|
| Liquidations (Binance, Bybit, OKX) | **stored**, websockets as now | No venue serves liquidation history over REST. |
| Open interest + 4 long/short ratios (Binance, 5 m) | **stored**, the existing `OiLsPoller` | `/futures/data/*` keeps about 30 days and refuses older windows with -1130. |
| Economic calendar | **stored**, as now | The notifications and the chart read it. |
| **Funding** | **on demand, not stored (S1)** | See S1. |
| Candles, tickers, summary, market cards, F&G, market cap | cache only | The venue serves them whenever asked. |

Supporting rows stay with what they support: `collector_heartbeats` and `collector_gaps` (the poller
writes its outages there as stream `binance-perp:oi-ls-5m`), `symbols`, partition maintenance for
`liquidations`, `open_interest_5m` and `long_short_5m`.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| S1 | **Funding is not stored.** `mark_funding_1m` and `funding_settlements` are still dropped (WD-006). The Bybit/OKX funding streams still go (WD-010). | Binance and Bybit serve settled funding history over REST, and WD-009 already reads it that way (`FundingService`; dev-3's live check returned 21 settlements per venue for 7 days). Predicted funding has no history anywhere, and the chart shows only the current point. OKX's REST history is shorter than the other two (not measured here). If a long OKX funding history ever matters, the cheap fix is a once-per-settlement poller like OI/LS, not a socket. Revisit only on that request. |
| S2 | **The OI/LS poller stays as it is, boot backfill included.** Only the planned deletion is cancelled. | The backfill repairs any slot missing inside the venue's 30 days, so the stored history becomes gap-free whenever the box was down for less than 30 days. That is what makes stored rows worth reading past 30 days. |
| S3 | **The read rule for `/series/oi` and `/series/ls` (IB-080): the venue answers wherever it still has data, stored rows answer only for the older part.** The boundary is the first point the venue actually returned. | The coordinator suggested the reverse: stored first, venue for the rest. I chose venue first for three reasons. (1) The last 30 days stay exactly what WD-009 serves today: authoritative, complete, cached, no change in weight. (2) A recent hole in our own collection (a poller outage not yet backfilled, the boundary+20 s lag that `POLL_LIMIT` exists for) can never show up inside retention. (3) Taking the boundary from the venue's real first point, not from `now − RETENTION_MS`, means the venue's drifting -1130 edge cannot leave a hole between the two parts. A fresh database answers exactly like today. A box that has run for 3 months answers 3 months. |
| S4 | **One granularity per answer.** The period is `periodFor(from, min(to, now))` over the whole requested window. The venue part is asked at that period. The stored part is sampled at it in SQL: the last row per `date_bin(period, ts, epoch)` bucket. | Stored rows are 5 m. A year read raw is ~105 k rows per series. Sampling in SQL keeps the read small and makes the joined line look the same on both sides of the boundary. |
| S5 | **`coverageFrom`/`truncated` keep their meaning over the joined series.** `coverageFrom` is the first point of the joined answer. `truncated` is true when that is later than `from` + period. No contract change. | The dashboard (IB-081) reads these two fields once, whichever part supplied the start. |
| S6 | **Known limit, stated:** an outage longer than the venue's retention leaves a hole in the stored part that the line will bridge. The outage itself is recorded in `collector_gaps`. A `gaps` field on the response is the later fix if this ever happens. It is not built now. | It takes the box being down for about a month, and then the alert and `/health` will already have said so. |
| S7 | **Ops endpoints leave the public path.** Liveness moves from `/health` to `/healthz` and answers `{status}` only. `/health` belongs to the dashboard. `/metrics` answers 404 to any request carrying `CF-Connecting-IP`. | dev-1 and dev-3 both found the ops `/health` shadowing the dashboard route and showing collector internals on the bot origin. Through the tunnel, `/metrics` exposes the same internals (stream lag, Binance weight). Cloudflare adds `CF-Connecting-IP` to every tunnelled request and the box has no inbound port, so "header present" means "came from the internet". A spoofed header only gets the spoofer a 404. No env flag is needed, so this does not depend on IB-078's `TRUST_CF_CONNECTING_IP`. |

## 3. Weight and disk (arithmetic from the code, not measured)

- **Weight.** The universe has 40 symbols (30 crypto + 10 TradFi, `config/universe.yaml`), so steady
  state is 5 calls × 40 symbols per 5 min. That averages 40 weight/min, and inside one pass's minute
  it is ~200 (the poller header documents this pattern for 30). The boot backfill, which only runs
  on missing slots, is at most 5 × 18 × 40 = 3 600 calls paced at 120 ms. That is ~500/min for about
  7 minutes, below `WEIGHT_CEILING_1M` = 1 800 (on-demand reads refuse above that). IB-080 adds
  **0** venue calls.
- **Rows.** 40 symbols × 288 slots/day × 5 series = 57 600 rows/day ≈ 21 M/year. **Bytes per row are
  not known.** WD-010 measures them: the boot backfill writes 30 days at once, so `pg_total_relation_size`
  of the two tables ÷ 30 gives bytes/day right away. WD-010 reports GB/year against the box's 50 GB disk (owner ruling 2026-11-02).
  If the figure does not fit with room to spare, that is a retention decision for the owner, not a
  silent cut.

## 4. Tasks

- **WD-006**: `open_interest_5m` and `long_short_5m` move from "drop" to "keep".
- **WD-010**: the OI/LS poller and its writers, partitions, slot-grid and specs stay. Funding is
  stated as on demand. Disk measurement added.
- **WD-011**: S7 explicitly: `/healthz`, `/metrics` closed to tunnelled requests, the SPA owns
  `/health`; the compose healthcheck, `deploy.sh`, the RUNBOOK and `DASHBOARD_EXCLUDE` follow.
- **WD-012**: OI/LS panes stay. The dashboard route `/health` stays.
- **WD-016**: the "no tables to take it from" check now covers candles and funding only.
- **IB-080** (new, P1): the S3–S5 read rule.
- **IB-081** (new): the dashboard shows funding `unavailable` and OI/LS `coverageFrom`/`truncated`.
- **IB-077**: the `/health` step becomes S7's checks.
