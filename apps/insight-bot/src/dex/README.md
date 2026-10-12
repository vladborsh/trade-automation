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

## Other providers

| provider | what we ask for | rate |
|---|---|---|
| DexScreener | pair details for pools seen | to be measured before the poller lands |
| GoPlus | token security at first sight, +6 h, +24 h | to be measured before the poller lands |

Neither is implemented yet, and neither will be until its limit is measured the same way. Writing
"~N/min, per the docs" into a comment is the thing this file exists to prevent.
