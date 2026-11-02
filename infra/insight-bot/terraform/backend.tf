# IB-073 — state lives in S3, not as one copy on a laptop: that twice nearly lost the record of
# paid resources (LIVE-RESOURCES.md). The bucket is the backups bucket this stack manages
# (s3.tf, adopted by imports.tf); its lifecycle rule is filtered to `pg_dump/`, so it never
# expires anything under `tofu/`. Versioning keeps every earlier state as a noncurrent version.
# `use_lockfile` takes the lock as an S3 object next to the state — no DynamoDB table.
terraform {
  backend "s3" {
    bucket       = "vb-insight-bot-backups-apne1"
    key          = "tofu/insight-bot.tfstate"
    region       = "ap-northeast-1"
    encrypt      = true
    use_lockfile = true
  }
}
