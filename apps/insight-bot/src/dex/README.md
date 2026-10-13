# IB-028 — DEX snapshots: the rate accounting

Every loop here states its request rate per minute. That is a standing requirement for any new
venue poller, and the numbers below are **measured, not quoted**.

## GeckoTerminal — measured 2026-10-12, two occasions ~20 minutes apart

The commonly cited figure for the free tier is ~30 requests/minute. **It is not what the API
does.** Two independent limits, both observed:

**A burst limit.** Requests sent back to back are refused almost immediately:

```
45 rapid requests → 3 × 200, then 429 on request #4, 0.3 s in
```

**A sustained ceiling of about five requests per minute**, which does not improve however hard you
ask. Each row below is a continuous two-minute run, with a 45 s drain before it so one step cannot
poison the next:

| round | target rate | result | served |
|---|---|---|---|
| 1 | 24/min (2.5 s gap) | 11 ok, 37 refused | **5.4 ok/min** |
| 1 | 12/min (5 s gap) | 12 ok, 12 refused | **5.9 ok/min** |
| 2 | 6/min (10 s gap) | 10 ok, **2 refused** | 4.9 ok/min |
| 2 | 5/min (12 s gap) | 10 ok, **0 refused** | 4.9 ok/min |

**The boundary sits between 5/min and 6/min**: at a 12-second gap nothing was refused in two
minutes; at 10 seconds refusals start. Asking four times faster buys nothing — the served rate is
flat at ~5/min across a 5× range of request rates, which is what a hard per-minute allowance looks
like from outside.

### A measurement error worth recording

My first ladder reported refusals at every spacing including 3 s gaps, which would have put the
ceiling near zero. That was **contaminated by my own preceding burst** — the 45-request probe had
drained the window, and the ladder's 5-second pauses between steps were not enough to refill it. A
single request after a pause returned 200 immediately.

So the first ladder measured my own prior traffic, not the API. Hence the drain before every step
and the two-minute duration: a venue's published rate is a claim, the rate it tolerates under
continuous load is the fact, and **the rate it appears to tolerate right after you have hammered it
is neither**.

## The budget we actually spend

§10 asks for `new_pools` and `trending_pools` across four networks every 10 minutes:

```
4 networks × 2 listings = 8 requests per 10-minute cycle = 0.8 requests/minute
```

**0.8/min against a measured clean ceiling of 5/min is 16 %** — comfortably under the "stay below
half" instruction, which would allow 2.5/min. The margin is deliberate: the ceiling was measured on
one day from one IP, and a poller that sits at half its measured limit has nowhere to go when the
limit moves.

Within a cycle the eight calls are spaced **75 seconds apart** rather than issued together. Spacing
is what respects the burst limit — eight requests fired at once would take the 429 on the fourth,
and three of the four networks would silently collect nothing.

## DexScreener — measured 2026-10-12

**It batches, and that changes the budget by 20x.** `/latest/dex/pairs/{chain}/{a,b,c,...}` accepts
the whole page of 20 pool addresses in one request and returns 20 pairs. The estimate of "20 pools a
pass is 2 req/min" assumed one request per pool; with batching it is **one request per network per
cycle**.

| gap | attempts | successes | refused | median latency |
|---|---|---|---|---|
| 1000 ms | 28 (56/min) | 28 (56/min) | 0 | 43 ms |
| 500 ms | 54 (107/min) | 54 (107/min) | **0** | 36 ms |

Successes track attempts exactly — which is also the control that proves GeckoTerminal's flat ~5/min
was a venue ceiling and not our own serialisation. Tolerated: **at least 107/min**.

**Our budget: one batched request per GeckoTerminal page = 8 per 10-minute cycle = 0.8/min**,
under 1 % of what it tolerates. It rides along with the page rather than having a schedule of its
own, because the addresses it needs are the page.

### Two shape findings, measured 2026-10-12 on two occasions ~20 minutes apart

**1. EVM pair addresses come back in different letter case.** GeckoTerminal returns them
lower-cased; DexScreener returns them EIP-55 checksummed.

| network | requested | returned | matched exactly | matched case-folded |
|---|---|---|---|---|
| solana | 20 | 19, then 20 | 19, then 20 | same |
| base | 20 | 20, then 20 | **17, then 18** | 20, then 20 |

An exact-string join would have **silently dropped 10–15 % of EVM pairs**, and the loss would have
looked exactly like "DexScreener does not know these pools". So the join folds case on EVM, where
hex case carries no meaning, and **not on Solana**, where base58 is case-sensitive and `A` and `a`
are different addresses. `dexscreener.ts` throws if two pairs ever fold to one key, because at that
point the fold is wrong for the chain rather than the venue being odd.

**2. `liquidity` is absent from the pair object more often than not on Solana** — 1 of 20 and 6 of
19 carried it on the two occasions, against 19 of 20 both times on Base. It is the field §10 names
first, so a `coalesce(liquidity_usd, 0)` anywhere downstream would report most new Solana pools as
having no liquidity at all. Null, like every other reading here.

Both are *shapes*, pinned by committed fixtures that carry the **requested address list beside the
response** — without it neither claim is expressible, since both are properties of the request set.
Neither is a number, so neither is subject to the repetition rule; the counts above are reported
because they are what was seen, not as limits.

## GoPlus — measured 2026-10-12

| gap | attempts | successes | refused | median latency |
|---|---|---|---|---|
| 2000 ms | 14 (26/min) | 14 (26/min) | 0 | 269 ms |
| 1000 ms | 24 (46/min) | 24 (46/min) | **0** | 265 ms |

Tolerated: **at least 46/min**.

**It does NOT batch on Solana.** `contract_addresses=a,b,c,d` with four VERIFIED-distinct tokens
returns exactly one result. (Checked the inputs were distinct before concluding — the first probe
used five addresses that might have shared a base token, and "it does not batch" and "I sent the
same token five times" produce identical output.)

So GoPlus is **one request per token**, which makes it the dominant consumer:

```
first sight:  <= 20 new tokens x 4 networks per cycle = <= 80 req / 10 min = 8/min  (worst case)
re-checks:    each token again at +6 h and +24 h
```

8/min against a measured 46/min is ~17 %. The worst case assumes every pool in every page is a new
token every cycle, which it is not — tokens repeat across cycles and across pools, and only a
first sighting needs the first-sight call.

## Three APIs, three budgets

| provider | our rate | measured ceiling | share |
|---|---|---|---|
| GeckoTerminal | 0.8/min | ~5/min (hard) | 16 % |
| DexScreener | 0.8/min | >= 107/min | < 1 % |
| GoPlus | <= 4/min (capped) | >= 46/min | <= 9 % |

GeckoTerminal is the binding constraint and the only one with a ceiling low enough to matter.

## The loop that spends it (`dex.service.ts`)

The tick is the rate limiter, not a comment asking the caller to be careful:

- a 15-second tick does **at most one** GeckoTerminal call, and `nextDue` refuses to return
  anything within 75 s of the last one, so the spacing is a property of the loop;
- DexScreener is one batched call per page, so it cannot exceed GeckoTerminal's rate;
- GoPlus is capped at **one call per tick = 4/min**, which is the only budget driven by data
  rather than by the schedule — a cycle can discover up to 80 new tokens. A backlog is visible and
  harmless; a burst is a 429 and a hole in the history.

The three security stages (`first_seen` at offset 0, `h6`, `h24`) are **round-robined**, because
first sight has the largest and most renewable backlog: a fixed order would let a busy day on
Solana permanently starve the re-checks, and the re-check is the entire reason the schedule has
three looks rather than one.


## GoPlus field presence, per chain family

A field we read being absent has two causes and they need opposite handling: the API changing shape
must throw, a token GoPlus has nothing to say about must become `null` meaning *not told*. One
assertion covering both threw on normal data and lost the row — permanently, because a failed ask
is retried and then abandoned, so we would have ended up ignorant about a token's security
*because* the venue answered. Found by the live pass inside the hour.

So every field is classified in `FIELD_CONTRACTS` and the classification carries its evidence:

| occasion | tokens from | solana answered | evm answered |
|---|---|---|---|
| A, 00:30–00:50 UTC (three sequential probes) | GeckoTerminal `new_pools` | 12 | 24 (base 8, eth 7, bsc 9) |
| B, 00:56 UTC | `dex_tokens`, after a 25-minute live run | 8 | 12 (base 7, eth 5, bsc 0 answered) |

Two occasions ~20 minutes apart with ≥ 5 answered tokens per family in each, on **different token
sets** — a per-token property measured twice on the same tokens is measured once. Absences seen, by
distinct token:

| family | field | observed absent | class |
|---|---|---|---|
| solana | `metadata_mutable` | 1 of 12 in A, 1 more during the live run | optional |
| evm | `is_open_source` | 4 of 9 answered BSC tokens in A | optional |
| evm | `total_supply` | 1 of 7 answered base tokens in B, 1 in the live run | optional |
| evm | `cannot_buy` | 1 base token during the live run | optional |
| evm | `buy_tax`, `sell_tax` | **both** absent on BSC token `0x8d0d…08b0d`, 20 minutes into the 24-hour run | optional |

### EVM has NO always-present field, and that is a measurement

The 24-hour run falsified the last two candidates inside twenty minutes: that BSC token answers with
`cannot_buy`, `holder_count`, `is_open_source`, `total_supply`, `is_honeypot` and `is_proxy` — and
neither tax field. A **third** distinct EVM field set, after the 14-field and 29-field fixtures.

So `ALWAYS_PRESENT.evm` is deliberately empty, which means:

- **a per-response detector for "this field vanished" does not exist on this payload.** That is what
  5-of-29 shared names means, and pretending otherwise is what discarded good rows;
- **the detector is the rate** — a field answered for most tokens dropping to none, on the coverage
  surface. It was built for this and is now the only thing that could see it;
- **the API is identified by its ENVELOPE, not by the per-token fields.** With nothing guaranteed
  per token, a guard on the union of per-token names is the weakest in the subsystem: one
  coincidentally-matching key would pass it. The envelope — numeric `code`, string `message`,
  `result` object-or-null — has not varied once across every fixture and both families, so that is
  what `assertEnvelope` throws on;
- **the family check fires on POSITIVE evidence only.** It throws when the *other* family's
  distinctive fields are present and this family's are not, which is evidence we are about to file
  one chain's data under another's label. It no longer throws on a sparse token carrying neither
  family's markers: with every EVM field optional, a genuine token answering with only
  `is_honeypot` and `total_supply` has no distinctive field, and throwing on it would discard a real
  answer. Absence of evidence is not evidence — the day's distinction, applied to the guard itself.

`test/dex/field-contracts.spec.ts` pins the emptiness together with its reason, so refilling the
list from a clean window is a failing test rather than a tidy-up. Solana still has five
always-present fields on 37-for-37; if the run falsifies one, the move is the same again.

### The classification was falsified within minutes, and that changed the mechanism

Minutes after `holder_count` was classified `always` on the strength of 36 answered tokens, the live
run hit an Ethereum token omitting **both `holder_count` and `total_supply`**. Comparing the two real
EVM responses:

```
shared by both:  buy_tax, cannot_buy, is_in_dex, is_open_source, sell_tax   (5)
one only:        14 fields in one, 29 in the other
```

**GoPlus EVM is not one shape with optional fields; it is a per-token field set** — 5 of 29 names in
common. "Present in every token I sampled" is a weak basis for a rule that throws, and the next
sample keeps falsifying it. So:

- a field classified `always` going missing is **recorded and raised, not thrown**: the row is
  stored, `absent_fields` names it, and the collector logs it at ERROR with the evidence behind the
  classification, so the reader can tell "the API changed" from "that classification was too strong";
- a **throw** is reserved for a payload carrying no field distinctive to the family, where there is
  nothing to record — a renamed payload, the wrong chain family, or an error object wearing a 200.

That keeps the requirement that a key we rely on must not vanish into a silent null, without the
data loss: the first version discarded rows for tokens whose response does carry `is_honeypot`.
**A field without two occasions behind it is `optional`** for the same asymmetry — a wrong
`optional` is a null visible in `absent_fields`, a wrong `always` was losing rows.

### And a correction to my own earlier finding

I reported that `is_honeypot`, `is_proxy` and `owner_can_change_balance` "exist in neither
response" — a claim about the API made from two fixtures. The second EVM response carries
`is_honeypot`, `is_proxy` and `is_mintable`. What does not exist is the **documentation's spelling**
`owner_can_change_balance`; the real name is `owner_change_balance`. We do not read any of them yet
and `raw` keeps them all, so nothing is lost while whether to read them is decided — but a honeypot
flag being available for some tokens is worth a decision.

Reproduce with `infra/insight-bot/probe-goplus-field-presence.mjs` (reads tokens from
`DATABASE_URL`, so it costs no GeckoTerminal budget).

### A counting error worth recording

The live log showed **11** warning lines naming these fields and I first reported them to the Tech
Lead as 11 tokens. They are **3 distinct tokens**: a failed ask is retried up to five times, so the
retry inflated the count fivefold. *A rate of absence measured from a log that retries is a rate of
retries.*

### Not a number: GoPlus's "no result at all" rate

BSC answered 0 of 8 tokens in occasion B against 9 of 10 in A, and `empty` results appeared on every
network. One occasion per direction, so this is a note, not a rate — but a token GoPlus returns no
result for is state 3 (asked, told nothing), not a failure, and must not be retried for ever.

## Running a live pass

```
DATABASE_URL=postgres://localhost:5432/insight_dev<N> LIVE_MINUTES=30 \
  npx ts-node -P tsconfig.json scripts/live-dex-pass.ts
```

One instance at a time per slot: two would double the GeckoTerminal rate, and the whole schedule is
sized against a measured ~5 requests/minute ceiling. It migrates, ensures the partitions, then
drives `tick()` until the duration is up — no Nest boot, so nothing else in the app starts.

Five defects have come out of these passes that no fixture could have caught: zero-tagged articles
(IB-027), the `eth` vs `ethereum` chain slug, a presence assertion that discarded good rows, a field
set 83 % unstable between two responses, and three documented GoPlus fields that turned out to be
one invented name rather than three.

## The rate is the only detector, so the baseline is readable

With no always-present EVM field, nothing per-response can notice a field disappearing: the rate is
it. A detector whose only consumer is "somebody remembers to look" is not a detector, so:

```
DATABASE_URL=… npx ts-node -P tsconfig.json src/ops/dex-field-presence.cli.ts [days]
```

prints presence per family per **UTC day** plus each field's **observed floor** — the figure a
threshold would be built from. The series needs no new table: every answered row already carries
`checked_at` and `absent_fields`.

**No alarm is wired to it, deliberately — and the deferral has a stated expiry.**
`BASELINE_DAYS_REQUIRED = 14` days per field per family, and the CLI prints how far each field has
got (`1/14 days accumulating` / `READY`) with a line saying what the threshold would then be:
*"below this field's own observed floor, over a population of at least 5 answered asks"*.

Not a fixed percentage across fields: `metadata_mutable` sits near 92 % legitimately while
`mintable` sits at 100 %, so one threshold would either miss the first or cry about the second. And
the **floor** rather than the mean, because a mean hides a bad day and the question is exactly
whether a field ever stopped arriving.

Fourteen days matches the discipline used on the GeckoTerminal ceiling and the feature warm-up. The
number exists because *"pending enough history"* with no horizon becomes never, and **a deliberate
absence with no removal condition is indistinguishable from an omission six months later** — the
person reading it cannot tell whether to act. When every field reads READY the condition is met and
the alarm should be built.

First day of the 24-hour run, for the record: solana floors 100 % except `metadata_mutable` at 92 %
(48/52); evm floors 97–100 %, with `cannot_buy` lowest at 97 %.

