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

**Our budget: 4 requests per 10-minute cycle = 0.4/min**, under 0.4 % of what it tolerates.

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
| DexScreener | 0.4/min | >= 107/min | < 0.4 % |
| GoPlus | <= 8/min worst case | >= 46/min | <= 17 % |

GeckoTerminal is the binding constraint and the only one with a ceiling low enough to matter.
