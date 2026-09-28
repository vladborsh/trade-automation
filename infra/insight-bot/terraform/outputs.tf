output "instance_id" {
  description = "For `aws ssm start-session --target <id>` and the deploy job's send-command."
  value       = aws_instance.insight_bot.id
}

output "image_ref" {
  description = "The GHCR image the box pulls (ECR is not used — COST-PLAN.md)."
  value       = var.image_ref
}

output "backup_bucket" {
  description = "Where the nightly pg_dump lands."
  value       = aws_s3_bucket.backups.bucket
}

output "deploy_role_arn" {
  description = "Role GitHub Actions assumes; null when the OIDC inputs were left empty."
  value       = local.deploy_role_enabled ? aws_iam_role.deploy[0].arn : null
}
