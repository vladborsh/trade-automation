output "instance_id" {
  description = "For `aws ssm start-session --target <id>` and the deploy job's send-command."
  value       = aws_instance.insight_bot.id
}

output "ecr_repository_url" {
  description = "Push target of the GitHub Actions job."
  value       = aws_ecr_repository.insight_bot.repository_url
}

output "backup_bucket" {
  description = "Where the nightly pg_dump lands."
  value       = aws_s3_bucket.backups.bucket
}

output "deploy_role_arn" {
  description = "Role GitHub Actions assumes; null when the OIDC inputs were left empty."
  value       = local.deploy_role_enabled ? aws_iam_role.deploy[0].arn : null
}
