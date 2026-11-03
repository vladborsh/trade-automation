# The image registry (architecture/ecr-image-2026-11-03.md). One private repository in the box's
# region; the box pulls with its instance role, so nothing depends on GitHub visibility.

# E1: AES256 (no KMS charge). force_delete = false: tofu must never be able to drop the images the
# box runs from. E2: immutable tags — `sha-<12>` names exactly one image, for ever. E4: basic
# scan-on-push, informational only.
resource "aws_ecr_repository" "insight_bot" {
  name                 = "insight-bot"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = true
  }
}

# E3: untagged layers go after a day; only the newest 10 sha- images stay (ten deploys of rollback).
resource "aws_ecr_lifecycle_policy" "insight_bot" {
  repository = aws_ecr_repository.insight_bot.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "untagged images expire after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "keep the newest 10 sha- images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["sha-"]
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = { type = "expire" }
      },
    ]
  })
}
