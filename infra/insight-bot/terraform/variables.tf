variable "region" {
  description = "Design §7: Tokyo, so the venue sockets are close and not in a blocked region."
  type        = string
  default     = "ap-northeast-1"
}

variable "instance_type" {
  description = <<-EOT
    t4g.micro (2 vCPU arm64, 1 GB) + a 2 GB swap file: what fits the user's hard 20 USD/month cap
    (COST-PLAN.md). t4g.small is one edit plus stop/start when the backfill of IB-012 needs it.
  EOT
  type        = string
  default     = "t4g.micro"
}

variable "root_volume_gb" {
  description = <<-EOT
    gp3 root volume; the Postgres data directory lives on it. 50 GB: owner ruling 2026-11-02,
    +2.88 USD/month over 20 GB (COST-PLAN.md). gp3 grows online (ModifyVolume + growpart + xfs_growfs); it cannot shrink.
  EOT
  type        = number
  default     = 50
}

variable "backup_bucket_name" {
  description = "Globally unique S3 bucket for the daily pg_dump. Must be set explicitly."
  type        = string
}

variable "backup_retention_days" {
  description = "Design §7: 35 days, current and noncurrent versions alike."
  type        = number
  default     = 35
}

variable "budget_alert_usd" {
  description = "AWS Budgets alerts the user above this monthly spend; 2 USD under the 20 cap."
  type        = number
  default     = 18
}

variable "budget_alert_email" {
  description = "Where the budget alert goes. Empty disables the budget (not recommended)."
  type        = string
  default     = ""
}

variable "ssm_parameter_prefix" {
  description = <<-EOT
    SSM Parameter Store prefix holding the SecureStrings the deploy step renders into the host's
    root-only .env. The parameters themselves are NOT created here: their values are secrets and
    belong to the user (RUNBOOK §4 has the put-parameter commands).
  EOT
  type        = string
  default     = "/insight-bot"
}

variable "deploy_role_github_sub" {
  description = <<-EOT
    The GitHub OIDC subject allowed to assume the deploy role (ECR design E6): workflows on master
    of this repository only. The repository uses GitHub's IMMUTABLE subject (owner and repo carry
    their numeric ids: `gh api repos/<o>/<r>/actions/oidc/customization/sub`), so the plain
    "repo:vladborsh/trade-automation:…" form never matches — found by the first CI deploy (IB-082).
    The ids also mean a renamed or re-created repository is not trusted by accident.
  EOT
  type        = string
  default     = "repo:vladborsh@11244920/trade-automation@1376010429:ref:refs/heads/master"
}

variable "open_web_ports" {
  description = <<-EOT
    Inbound TCP ports open to the internet for Caddy (https-without-domain H3). Opened in two steps
    (H8): [80] first, so Caddy can obtain the certificate (ACME HTTP-01) while the routes are
    proven on the box; then [80, 443], the site, last. [] closes them again.
  EOT
  type        = list(number)
  default     = [80, 443] # opened 2026-11-03 (IB-082 step D); [] closes both

  validation {
    condition     = alltrue([for p in var.open_web_ports : contains([80, 443], p)])
    error_message = "Only 80 and 443 may be opened: never SSH, never the app's 3005."
  }
}
