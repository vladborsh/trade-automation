# infra/insight-bot — IB-013

Hosting for `apps/insight-bot` (design `architecture/insight-bot-system-design.md` §7, D14):
one EC2 `t4g.small` in `ap-northeast-1`, docker compose with `postgres:16-alpine`, secrets from
SSM, a nightly `pg_dump` to S3, and a deploy path through ECR + `ssm send-command`.

> **Nothing has been applied.** No AWS resource exists: `terraform apply` and every other AWS
> action wait for the user's go-ahead (tasks/insight-bot.jsonl IB-013, Tech Lead note 2026-09-28).
> No AWS credentials were requested or used to write any of this.

## Layout

```
probe-venues.mjs              venue connectivity probe — run FIRST on a fresh box (§7)
RUNBOOK.md                    operations, in plain Russian (deploy, restore, rotate, /health, alerts)
terraform/                    the stack: EC2, security group, IAM, S3 backups, Budgets
  versions.tf variables.tf main.tf iam.tf s3.tf budgets.tf outputs.tf
  user_data.sh.tftpl          first-boot script; inlines the files below so the box needs no repo
  terraform.tfvars.example    the two inputs a reviewer must set
  backend.tf.example          S3 state backend, for after the first apply
compose/docker-compose.yml    what runs on the box (NOT local dev — that is apps/insight-bot/)
scripts/                      render-env.sh, deploy.sh, backup.sh, restore.sh
systemd/                      insight-bot-backup.{service,timer} — 01:00 UTC
```

The GitHub Actions job is `.github/workflows/insight-bot-deploy.yml` (manual trigger for now).

## What a reviewer should check

- **No inbound ports.** `aws_security_group.insight_bot` has egress only; access is Session Manager.
- **No secrets anywhere.** Terraform creates no SSM parameter; `render-env.sh` pulls them at deploy
  time into a root-only `.env`. The RUNBOOK §4 has the `put-parameter` commands for the user.
- **Least privilege.** The instance role can pull only this ECR repo, read only `/insight-bot/*`,
  decrypt only via SSM, and write only the backup bucket.
- **Backups.** Versioned bucket, 35-day expiry on current and noncurrent versions, and a restore
  drill (`restore.sh … --into-check`) that never touches the live database.
- **Cost.** ≈ **13.6 USD/month** against the user's hard 20 cap (`COST-PLAN.md`): `t4g.micro`
  + 20 GB gp3 + the public IPv4 charge the first estimate missed + a few cents of S3. No ECR, no
  NAT gateway, default VPC, and an AWS Budgets alert at 18 USD.

## The order of the apply (agreed with the Tech Lead)

0. The user follows `SETUP-RU.md` and tells me the profile exists (plus the e-mail for the budget).
1. `cd terraform && cp terraform.tfvars.example terraform.tfvars` — the bucket is
   `vb-insight-bot-backups-apne1` (a short suffix if the name is taken).
2. `AWS_PROFILE=insight-bot terraform init && terraform plan` — **the plan goes to the Tech Lead
   before any apply**, then apply step by step with a report after each.
3. The user's secrets into SSM (RUNBOOK §4); I never print a value.
4. On the box: `probe-venues.mjs` first, result into RUNBOOK §8. A mute venue escalates.
5. Deploy the image, then the restore drill once, then the report.

## Local checks that need no AWS

```bash
node --check infra/insight-bot/probe-venues.mjs
bash -n infra/insight-bot/scripts/*.sh
docker compose -f infra/insight-bot/compose/docker-compose.yml config -q   # needs the env vars set
terraform -chdir=infra/insight-bot/terraform fmt -check
terraform -chdir=infra/insight-bot/terraform validate                       # needs `terraform init`
```
