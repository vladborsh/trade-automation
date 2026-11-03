# insight-bot hosting under a hard 20 USD/month cap (IB-013, user decision 2026-09-28)

The first plan (t4g.small, 50 GB, ECR) came to ~22–25 USD and **misses a charge**: since February
2024 AWS bills **every public IPv4 address in use, ~3.65 USD/month**, which the design's estimate
did not include. With it, the old shape is ~25 USD — over the cap however you squint.

This is the re-plan. Prices are **ap-northeast-1 on-demand, as published when this was written**;
they are estimates to re-check in the AWS calculator, not quotes.

## Chosen shape: t4g.micro + 50 GB gp3 + swap — **≈ 16.5 USD/month**

50 GB is the owner's ruling of 2026-11-02 (it was 20 GB ≈ 13.6 USD/month). The budget alert at
18 USD leaves ≈ 1.5 USD/month of headroom: a `t4g.small` upgrade would now cross it.

| Line | Detail | USD/month |
|---|---|---|
| EC2 `t4g.micro` (2 vCPU arm64, 1 GB) | ~0.0108/h × 730 h, on-demand, no commitment | **7.88** |
| EBS gp3 root, 50 GB | 50 × 0.096; 3000 IOPS and 125 MB/s are included free | **4.80** |
| Public IPv4 (1 address, in use) | 0.005/h × 730 h — the line the old estimate missed | **3.65** |
| S3 backups | ~6 GB average held (35 daily `pg_dump -Fc`, lifecycle-expired) × 0.025 | **0.15** |
| S3 requests | ~1 PUT/day + occasional GET | **0.01** |
| Data transfer out | venue REST/WS + Telegram; far below the 100 GB/month free allowance | **0.00** |
| ECR | at most 10 images × image size × 0.10/GB-month (ECR design E3; size measured at the first push) | ≈ 0.0x |
| NAT gateway / ALB | not used, and never will be for this design | 0.00 |
| AWS Budgets | first two budgets are free | 0.00 |
| **Total** | | **≈ 16.49** |

**Headroom to the cap: ~3.5 USD/month** (it was ~6.4 at 20 GB; the 2.88 for 50 GB came out of it).

## Why not t4g.small

| Option | USD/month | Verdict |
|---|---|---|
| t4g.micro + 20 GB | ≈ 13.6 | fits, with headroom |
| t4g.small + 20 GB | ≈ 21.5 | **over the cap** on-demand |
| t4g.small + 20 GB, 1-year no-upfront Compute Savings Plan | ≈ 17.1 | fits, but commits the user for a year — their call, not mine |
| t4g.micro + 50 GB (chosen 2026-11-02) | ≈ 16.5 | fits |
| IPv6-only (no public IPv4) | −3.65 | rejected: venue and Telegram reachability over IPv6 is not something I can promise |

## What t4g.micro costs us, honestly

1 GB of RAM for Postgres **and** the collector is tight. Mitigations, all in the IaC:

- a **2 GB swap file** on the EBS volume (`user_data`), so a burst pages instead of OOM-killing;
- Postgres tuned small: `shared_buffers=256MB`, `max_connections=20`, `effective_cache_size=512MB`,
  `work_mem=4MB`, `maintenance_work_mem=64MB`;
- the collector is I/O-bound, not memory-bound: it holds one socket, a per-symbol last sample and
  batched writes of ≤ 500 rows.

**The known risk is IB-012's historical backfill** (zips, parallel downloads, big upserts). If it
OOMs on 1 GB, the cheap answer is to stop the instance, run the backfill on `t4g.small` for the
hours it takes, and stop back down — an upgrade for one day costs ~0.26 USD, not 8. I would rather
do that than pay for `small` all year for a job that runs once.

**Disk:** ≈ 8–10 GB/year with indexes (§3.3), so 20 GB is roughly a year. gp3 grows online with no
downtime, and the Budgets alert will fire long before the disk is the problem.

## The cost guard

An **AWS Budgets** monthly cost budget `insight-bot-monthly`, **actual > 18 USD → e-mail the
user**, plus a forecast alert at the same threshold so it warns mid-month rather than after the
bill. 18 leaves 2 USD of slack under the 20 cap. It is in the Terraform, so it exists from the
first apply — not something to remember later.

## Deploy path: ECR, deployment through SSM (since 2026-11-03)

The earlier choice of GHCR (git history of this file) was reversed by the user's ruling of 2026-11-03: the
image lives in **AWS ECR** (`architecture/ecr-image-2026-11-03.md`). Reason: the repository may go
private, and with ECR the box pulls with its instance role, so nothing depends on GitHub
visibility and no GitHub token sits in SSM. ECR bills only stored GB (≤ 10 images kept) and a
same-region pull is free: cents per month. Deploys still run through SSM Run Command, from CI by
OIDC or by hand (RUNBOOK §3).

## What changed in the IaC to match

| Before | Now |
|---|---|
| `instance_type = "t4g.small"` | `"t4g.micro"` (variable, so a stop-change-start upgrade is one edit) |
| `root_volume_gb = 50` | `20` (back to `50` by the owner's ruling 2026-11-02) |
| `ecr.tf` with a repository and lifecycle policy | deleted for GHCR, then **back** (2026-11-03, ECR design): immutable `sha-` tags, keep 10 |
| instance role could pull from ECR | pull from the one repository again (2026-11-03); reads `/insight-bot/*`, writes the bucket |
| no budget | `budgets.tf`: `insight-bot-monthly`, actual and forecast alerts at 18 USD |
| no swap | 2 GB swap file created in `user_data` before the containers start |
| compose `postgres` tuned for 2 GB | tuned for 1 GB (above) |

Everything else — no inbound ports, SSM-only access, secrets only in SSM, versioned bucket with a
35-day lifecycle, nightly `pg_dump` — is unchanged.
