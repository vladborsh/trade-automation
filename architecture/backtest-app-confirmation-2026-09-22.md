# Architect confirmation — backtest app P0 clusters, and the T-035 sizing spec

**Author:** Architect · **Date:** 2026-09-22 · **Input:** the Tech Lead's
confirmation request (26 items over `bt-core-libs`, `bt-session-api`,
`bt-auth`, `bt-platform`, `bt-workspace`; all of T-001…T-034 and
BUG-001…BUG-013 merged, green at the Tester's gate, final user walk green
on master `1d69e7a`). Read against `architecture/backtest-app-system-design.md`
and the code on master (`fa648d9`).

Role-to-role technical material. Verdict vocabulary: **confirm** (built as
designed, or the provisional rule is adopted as the design), **confirm with
amendment** (adopted; the design text is changed to say so — the amended
sections are listed in §4), **overrule** (change wanted; the change is a task
in `tasks.jsonl`, listed in §5).

---

## 1. Verdict per cluster

| Cluster | Verdict | Notes |
|---|---|---|
| `bt-core-libs` (T-001/002/003/005/006, BUG-001) | **Confirmed** | `replay-core` and `indicators` are pure, I/O-free, consumed as built packages by both runtimes; the fill table in §6 is implemented as written (item 11); statistics as §8 plus the R counterparts (item 1). The provisional constants (`MIN_STOP_DISTANCE_FRACTION`, `BACKTEST_BOUNDS`) become design. |
| `bt-session-api` (T-011/013/014/015/017/018, BUG-002/003/004) | **Confirmed with amendments** | Every mutation runs through one `runSessionMutation` transaction with the opId fingerprint (item 10); the advance walks 1m with the pessimistic fallback (item 13); modify semantics (19b) adopted. Amendments: §7.2 error codes, three plain-bodied refusals get codes (item 5 → T-055), numeric-overflow legibility (item 9 → T-059). |
| `bt-auth` (T-007/008/009/010, BUG-005) | **Confirmed** | The invite claim-then-insert order (item 14) is the correct transactional shape and replaces the single-UPDATE wording in §7.1. Throttle trade-off accepted. |
| `bt-platform` (T-004/012/016, BUG-006/007/008/011/012/013) | **Confirmed with amendments** | Read-only stores in replay mode as a DI-boundary decorator (item 16) is the right seam. Migrations 002/003 adopted into §3. BUG-007's right-offset cap is a design decision, taken here (item 22 → T-056). |
| `bt-workspace` (T-019…T-024, BUG-009/010) | **Confirmed with amendments** | §5.4 is amended to the anchoring the client actually needs (item 20). AdvanceQueue rules (item 18) adopted. `PanelSource` growth (item 21) adopted into §2.3. The replay panels' live venue dot is an accidental coupling to the live `ConnectionStore` (→ T-060). |

No cluster fails. Component boundaries hold: no SQL outside `pg/`, no
venue call on the replay path, one fill implementation on both sides, the
chart kit consumes `PanelSource` only. The two accidental couplings found
are small and listed as tasks (T-060 venue dot; the `jobs/` store factory,
item 17, is fine as is — see there).

---

## 2. Verdict per item

### A. Contract changes (libs/contracts)

| # | Item | Verdict |
|---|---|---|
| 1 | `SessionStats` R counterparts (`pnlR`, `grossProfitR`, `grossLossR`, `avgWinR`, `avgLossR`, `StatsBreakdown.pnlR`) | **Confirm.** Verified in `libs/contracts/src/backtest.ts:358-387`. Every currency figure now has an R twin (`maxDrawdownCcy`/`maxDrawdownR`, equity `balance`/`balanceR`); `expectancyR` and `maeAvg`/`maeWorst` are R-only by nature (§8 defines MAE in R terms), which is correct, not a gap. |
| 2 | `SessionStatsResponse.stored: SessionAggregates`; drift = projection vs stored row after rounding to column scale; detection only | **Confirm.** `stats-drift.ts` rounds per column scale (money 8, R 6, percent 4) before comparing; `drift` stays a boolean. Detection-only is right: the stored row is a cache of the same function, a repair path would hide the bug it exists to reveal. |
| 3 | New codes `BALANCE_NOT_POSITIVE` 422, `NO_PRICE_AT_CURSOR` 422, `ORDER_NOT_OPEN` 409 | **Confirm.** Remove the "provisional pending Architect" annotations at `backtest.ts:520-525` in the next touch of that file (T-055). |
| 4 | Numeric bounds on request fields (`riskPct` [0.0001, 100]; `initialBalance` (0, 1e12); `commissionPct` [0, 100]; `spread` [0, 1e12); `notionalWarnMultiple` (0, 999 999.99]; levels (0, 1e12)); out of range is 400 | **Confirm.** They are the column ranges, and a value outside a column is malformed input, not a domain refusal. `notionalWarnMultiple` disappears with T-035/T-053 (§3 below). |
| 5 | Plain Nest bodies (no contract code) for 401, 403, 404, 503, 409 self-disable, 409 opId reused, 409 panel with live orders | **Confirm for 401/403/404/503/self-disable** — they are transport or admin conditions; the client keys on the status and that is enough. **Overrule for the three backtest refusals the replay client must react to:** opId reused for a different request → 409 `OP_ID_REUSED`; removing or re-pointing a panel with live orders → 409 `PANEL_HAS_ORDERS`; off-minute `toCursorMs` → 400 `CURSOR_OFF_MINUTE`. Rationale: the AdvanceQueue reloads the session on "any other 4xx" (item 18); a coded body lets it say *why* in the notice and lets the layout editor keep the panel with an explanation instead of a generic reload. **→ T-055.** |
| 6 | `IndicatorSeriesSpec.scale: 'price' \| 'pane'`, optional `range`, `levels`; pane rendering via lightweight-charts v5 panes inside `IndicatorLayer` | **Confirm.** One pane per indicator instance, `range` as a fixed autoscale, `levels` as dashed price lines — that is the contract. Note for the record: `keys[].style` is `'solid' \| 'dashed'` (dash style), not a plot type; the histogram request (item 23a) therefore adds a separate field, not a value. |
| 7 | `SessionPanelSchema.indicators?: {id, params}[]`, carried opaquely | **Confirm.** Opaque is right: the catalogue is a client concern, the server stores what it is given. |

### B. Product and engine rules

| # | Item | Verdict |
|---|---|---|
| 8 | Minimum stop distance `\|entry − sl\| ≥ entry × 1e-5`, else 422 `STOP_DISTANCE_ZERO`; constant in `replay-core/sizing` | **Confirm.** 0.001 % of price is below any instrument's spread and above the float slack; it exists to keep `qty` and R inside their columns, not to police trading. Correction to the request's wording: the client applies the constant in `core/replay/place-check.ts` and `overlay/position-tool.geometry.ts`, not in `order-panel.view.ts` (which only surfaces `positionSize`'s error). Fine as built. |
| 9 | Migration 002 widens R columns and `profit_factor` to `numeric(20,6)`; residual: a balance/PnL ≥ 1e12 rolls the advance back | **Confirm the migration. Overrule the residual's failure mode.** Today the overflow surfaces as a 500 from Postgres; the AdvanceQueue retries 5xx indefinitely (item 18), so a session at the limit is a client spinning forever, not a "documented limit". Map SQLSTATE 22003 on the mutation path to 422 `VALUE_OUT_OF_RANGE`; the client treats that code as terminal for the session (stop the queue, notice "this session has reached the numeric limit"). The limit itself (1e12) stays. **→ T-059.** |
| 10 | Migration 003; opId replays only for the same kind and the same request fingerprint; else 409 | **Confirm.** `sha256(kind + canonical JSON of the request minus opId + orderId)` is the right key; pre-003 rows (null fingerprint) replaying unconditionally is acceptable for a dev-only database. The 409 gets a code under item 5. |
| 11 | Fill refinements: entry candle excluded from exit evaluation for open positions (both order types) and from MAE for market orders; `openRisk` counts a stop past entry as 0 | **Confirm the code, correct the statement.** The code (`fill/evaluate-order.ts:81-94`) excludes bars at or before `entryTimeMs` only for orders already open from an earlier advance; a **limit** order filled in the current walk has its exits evaluated on the fill candle, stop first, exactly as §6 says ("fill, then evaluate exits on that same candle"). For a market order the "entry candle" is the last *revealed* candle, which is behind the cursor and cannot exit — excluding it is the only consistent reading. MAE excluding the market entry candle (`fill/mae.ts:26`) follows for the same reason. `openRisk` clamping at 0 (`mark/mark.ts:24-31`) is right: a stop in profit risks nothing. |
| 12 | Stats conventions: `winRate = wins/trades` (breakeven not a win); `grossLoss`/`avgLoss` signed ≤ 0; `maxDrawdownPct` in percent vs the running balance peak; `balanceR` cumulative | **Confirm.** Also verified: `maxDrawdownR` is measured on the R curve itself (not converted from currency), which is what "in both currency and R" should mean for a drawdown. |
| 13 | Advance: off-minute `toCursorMs` → 400; equal cursor → no-op; end-of-session price searched back to the position's entry; no-1m instrument closes on the last closed session-tf bar flagged pessimistic; aggregates written only when something closed | **Confirm** (the 400 gets a code under item 5). The equal-cursor no-op still returns a full `AdvanceResult` and writes an ops row — correct, the client needs the replayable answer. |
| 14 | Invite accept: claim first, then insert the user | **Confirm.** One transaction; a taken email rolls the claim back (`auth.service.ts:136-155`). §7.1's single-UPDATE wording is replaced (§4). |
| 15 | Session create / layout PATCH: layout 422s on the raw body; malformed period 400; layout edit keeps the session currency; a panel with live orders cannot be removed or re-pointed | **Confirm.** Raw-body checking before the schema is the only way the named 422s stay reachable; keep the comment that says so. The panel refusal gets a code under item 5. |
| 16 | `MARKET_DATA_MODE=replay` (default) makes the four data stores read-only; no REST history for replay signals/calendar notifications; a notification may re-fire after restart | **Confirm.** A decorator at the DI factory boundary is the right seam (the jobs build the store directly and keep writing — structural, not a flag). The consequences are acceptable in replay mode; the screenshot store being deliberately unwrapped is correct. |
| 17 | Derive job gap-fills only; `--force` rewrites resampled bars only; the bucket completing exactly at the last stored 1m is emitted on the next run. Backfill throttled at 1 req/s | **Confirm.** The "next run" behaviour follows from the resampler closing a bucket only when a later 1m arrives; document it in the job's help text. On the follow-up "`jobs/` duplicates `buildCandleStore`": T-031 extracted a shared `jobs/candle-store.factory.ts`; the Nest `StorageModule` still has its own construction. Two builders for two runtimes (CLI vs DI) is acceptable — not a task. |
| 18 | AdvanceQueue: a 422 on `place` is a rejection (hint, queue continues); every other 4xx reloads the session; retries indefinite with capped backoff | **Confirm.** As built the rejection rule also covers 422 on `modify` (T-033) — correct, adopted. Backoff cap 8 s. With T-059, `VALUE_OUT_OF_RANGE` becomes the one 4xx that stops the queue instead of reloading. |
| 19 | Position tool: default SL 1 × ATR(14) of the closed bars (fallback 0.5 %), TP at 2R; stop entries refused; T-033 handles | **Confirm.** ATR from `libs/indicators` over the panel's closed bars — decision 11 honoured. |
| 19b | Modify: an open position's new levels are checked against the last revealed 1m close; a pending order against its limit; `sl_initial` and 1R never change | **Confirm.** This is the correct reading of "the wrong-side checks apply" for a live position: break-even and trailing stops must be allowed, and the R unit is fixed at placement by decision 21. |
| 19c | `ORDER_NOT_ACTIVE` 409; empty PATCH 400; a move to the current value writes no history row; `PanelSource.capture` | **Confirm.** The no-op move short-circuits before validation — harmless, since nothing changes. |

### C. Design gaps

| # | Item | Verdict |
|---|---|---|
| 20 | §5.4 `before = cursor` fails with `FUTURE_REQUESTED` because the server cursor trails; the client anchors history at `bucketStart(min(cursor, serverCursor), tf)` and folds the rest from the 1m ahead cache | **Confirm with amendment.** This is the right mechanism and it keeps decision 18 exactly (same cursor, forming bar from the same 1m). §5.4 rewritten (§4). Noted: the initial load and view-only use the raw cursor; both hold `cursor == serverCursor` by construction, so it is equivalent — no change required, but the parity spec should keep asserting `before ≤ serverCursor`. |
| 21 | `PanelSource` gained `points`, optional `researchScope`, `positionTools`, `capture` | **Confirm with amendment** to §2.3. Optional members for the replay-only and live-only concerns are the correct shape for a boundary consumed by two feeds. |
| 22 | A panel whose tape ends more than about one window before the others' (DXY over a weekend) cannot follow the shared window because of lightweight-charts' right-offset cap; padding with whitespace would lift it | **Decision: pad.** Decision 13 says each panel draws whatever it has at the cursor time; a panel that cannot *show* the cursor time breaks the synchronized window (decision 3). The replay panel source appends **whitespace points** (time only) from its last bar to the bucket containing the cursor, at the panel's timeframe, so every panel's time domain reaches the cursor; whitespace is not a candle (no fill, no indicator input, not counted by the ahead cache). Live panels are unaffected. **→ T-056.** |
| 23 | Not built: (a) `keys[].style += 'histogram'` for the MACD histogram; (b) catalogue entries may return `rect` overlays for FVG boxes | **Accept both, as a P2 task.** (a) as a new per-key field `plot?: 'line' \| 'histogram'` (default `line`), because `style` is the dash style (item 6). (b) through the existing `OverlayRect` shape in `contracts/signal.ts` delivered over `PanelSource.overlays` — the catalogue `compute` gains an optional `overlays` output; no new shape vocabulary. **→ T-057.** |
| 24 | Mixed UI language: T-032's stats page is Russian, the rest is English | **Recommendation (the user decides): one language for the app, English now.** The other nine screens, every hint, every refusal message and the contracts' messages are English; a single Russian page reads as an accident. Translating T-032 to English is one screen; going the other way is ten screens plus every server message, and would still be wrong for a Russian-speaking circle only if they read the *product* in Russian — the plain-Russian rule in `PROJECT.md` is for reports and presentations to the user, not for a product UI. If the user wants the app in Russian, the right move is Angular i18n with `ru` as the default locale, as one task over all screens — not a page-by-page drift. No task is written until the user picks. |

### D. Known follow-ups

Acknowledged; none blocks confirmation. Two remarks: `replay-session.store.ts`
at 533 lines is a store, not a component, so the 250-line rule does not
apply literally, but T-035's client task will touch it — the Tech Lead may
attach the split there. The journal screenshot column (`hasEntryShot`/
`hasExitShot` flags) is a reasonable P2 and needs no design.

---

## 3. T-035 — real leverage caps and lot sizes (spec)

Replaces decision 25's flat `notionalWarnMultiple` warning. The research is
in `knowledge/venue-contract-specs.md` (figures, entity/regime table,
sources, and the API request for the Tech Lead to confirm the step sizes).
The design change is written into the system design §6 ("Contract, sizing
and margin", amending decision 25) and §13; this section is the summary and
the decomposition.

**Figures (EU/UK retail regime — see the knowledge note for why):**

| Instrument | unit | multiplier | minQty | qtyStep | minNotional | maxLeverage |
|---|---|---|---|---|---|---|
| binance:BTCUSDT | BTC | 1 | 0.001 | 0.001 | 50 | 125 |
| binance:ETHUSDT | ETH | 1 | 0.001 | 0.001 | 20 | 125 |
| capitalcom:US100 | contracts | 1 | 0.001 | 0.001 | — | 20 |
| capitalcom:US500 | contracts | 1 | 0.01 | 0.01 | — | 20 |
| capitalcom:DXY | contracts | 1 | 1 | 1 | — | 10 |
| capitalcom:EURUSD / GBPUSD / EURCHF / GBPCHF | base units (`displayLot` 100 000) | 1 | 100 | 100 | — | 30 |

**Rules (all in `replay-core/sizing`, run by the client popup and the server):**

1. `notional = qty × multiplier × price`. Commission, spread cost, PnL, MAE
   and floating mark all take `qty × multiplier` where they took `qty`.
   With every multiplier at 1 no existing number changes.
2. Size from risk: `raw = riskRequested / (|entry − sl| × multiplier)`;
   `qty = floorToStep(raw, qtyStep)`. Rounding is **down**, never up — the
   trader never risks more than asked. `1R = riskAmountCcy = qty × |entry −
   sl| × multiplier`, i.e. the *actual* amount at risk after rounding
   (`riskPct` on the row stays the requested value; the popup shows both).
3. Below the venue minimum (`qty < minQty`, or `minNotional` set and
   `notional < minNotional`): **refuse**, 422 `SIZE_BELOW_MINIMUM`, message
   carrying the minimum size and the risk % it would need. A venue rejects
   such an order; sizing it up silently would break decision 21.
4. Margin: `marginRequired = notional / maxLeverage` at the planned entry.
   `usedMargin = Σ` over the session's **open and pending** orders of their
   own initial margin (at their entry or limit; pending orders reserve
   margin on both venues). `equity = balance + Σ floatingPnl(open)`.
   `available = equity − usedMargin`. If `marginRequired > available`:
   **refuse**, 422 `INSUFFICIENT_MARGIN`. The check is per order at
   placement, against the pooled session account (one account per session —
   decision 36; the two venues' separate accounts are not modelled, stated
   in §13). No maintenance margin, no margin call, no liquidation — decision
   25's "no liquidation" stands, and a stop-out can still take the balance
   negative through a gap.
5. Modify, cancel, close and advance do not re-check margin (qty never
   changes after placement).
6. The order row snapshots `contract_multiplier` at placement (migration
   004) so a later YAML change cannot re-price a closed trade;
   `notional_warn_multiple` is dropped from the row, the contracts and the
   create form.
7. Wire: `BacktestInstrument` (GET `/backtest/instruments`) carries the
   `contract` block; the client already loads this list for `pricePrecision`
   and reads the contract from the same map. An instrument without a
   `contract` block is not offered and is refused at session creation
   (`INSTRUMENT_NOT_AVAILABLE`).
8. Order popup (T-045 shell; T-054 content): size with its unit (`0.213
   BTC`, `20,000 EUR (0.20 lots)`, `0.33 contracts`), notional, margin
   required / available after, implied leverage `x of cap`, 1R and the
   effective risk % after rounding; the two refusals disable Confirm with the
   reason; margin utilisation above 80 % is shown amber (informational).
   The toolbar's `risk …` readout gains `margin …%`.

**Decomposition:** T-035 (rewritten: contracts + YAML + `replay-core`
sizing/margin, pure, with specs) → T-053 (server: instruments endpoint,
place refusals, order-row snapshot, migration 004, remove the multiple) →
T-054 (client: popup content, toolbar margin, create form, remove the
warning; depends on T-045 for the popup shell). Field ownership as usual:
the Tech Lead sets priority/cluster; my suggestion is `bt-sizing`, P0 for
T-035/T-053 and P1 for T-054 behind T-045.

---

## 4. Design sections amended (in `backtest-app-system-design.md`)

- Header status line: notes this confirmation and the amendment date.
- §1 D11 row unchanged; **new D12** (contract specs as configuration).
- §2.1 `sizing/` and `mark/` rows: the contract-aware signatures.
- §2.3 `PanelSource`: `points`, optional `researchScope`, `positionTools`,
  `capture`.
- §3 schema: R columns `numeric(20,6)` (migration 002), `backtest_ops.kind`/
  `fingerprint` (003), `orders.contract_multiplier` and the removal of
  `notional_warn_multiple` (004, T-053).
- §5.4: timeframe switch anchored at `bucketStart(min(cursor,
  serverCursor), tf)`; the extend-back of the 1m cache; whitespace padding
  (item 22).
- §5.5: opId semantics (kind + fingerprint), `CURSOR_OFF_MINUTE`, equal-cursor
  no-op, the end-of-session price search.
- §6: "Contract, sizing and margin" replaces the "Notional warning" and "No
  leverage model" bullets; the fill-table note on entry-candle exclusion.
- §7.1: invite accept transaction order; §7.2: `stored: SessionAggregates`,
  new codes (`BALANCE_NOT_POSITIVE`, `NO_PRICE_AT_CURSOR`, `ORDER_NOT_OPEN`,
  `ORDER_NOT_ACTIVE`, `SIZE_BELOW_MINIMUM`, `INSUFFICIENT_MARGIN`,
  `OP_ID_REUSED`, `PANEL_HAS_ORDERS`, `CURSOR_OFF_MINUTE`,
  `VALUE_OUT_OF_RANGE`), request bounds, the modify rule, the instrument
  `contract` block.
- §8: `winRate`, signed losses, `maxDrawdownPct`, R twins.
- §13: decision 25 row rewritten; a row for the pooled margin account.

## 5. Tasks written (`tasks.jsonl`, Architect fields only)

| Id | Title | Depends on | From item |
|---|---|---|---|
| T-035 (rewritten) | Contract specs in configuration and contract-aware sizing and margin in replay-core | — | §3 |
| T-053 | Server: place refusals on venue minimums and margin; order-row multiplier snapshot; drop the notional warning | T-035 | §3 |
| T-054 | Client: order popup shows size with unit, margin and effective risk; toolbar margin; remove the notional warning | T-053, T-045 | §3 |
| T-055 | Error codes for the three coded-less backtest refusals (`OP_ID_REUSED`, `PANEL_HAS_ORDERS`, `CURSOR_OFF_MINUTE`) | — | 5 |
| T-056 | Whitespace-pad a replay panel whose tape ends before the cursor so it follows the shared window | — | 22 |
| T-057 | Histogram plot style per indicator key and rect overlays from catalogue entries | T-034 | 23 |
| T-059 | Numeric overflow on a mutation is a terminal 422 `VALUE_OUT_OF_RANGE`, not a retried 500 | T-055 | 9 |
| T-060 | Replay panels show no live venue dot | — | extras |

(T-058 is reserved for the UI-language decision, item 24; not written.)
