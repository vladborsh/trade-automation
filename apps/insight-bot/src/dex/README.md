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

Everything else was present in every answered token on both occasions and is `always`: its absence
throws, and the throw quotes the evidence so the next person can tell "the API changed" from "this
classification was too strong". **A field without two occasions behind it is `optional`**, because
the errors are not symmetric — a wrong `optional` is a null visible in `absent_fields`, a wrong
`always` loses the row.

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
