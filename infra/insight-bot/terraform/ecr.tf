# The arm64 image GitHub Actions pushes and the box pulls (design §7).

resource "aws_ecr_repository" "insight_bot" {
  name                 = var.ecr_repository_name
  image_tag_mutability = "MUTABLE" # the box follows the :latest tag; every push is also tagged by sha

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Storage is billed per GB: keep the last 10 images, drop untagged ones quickly.
resource "aws_ecr_lifecycle_policy" "insight_bot" {
  repository = aws_ecr_repository.insight_bot.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 3 days"
        selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 3 }
        action       = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the last 10 tagged images"
        selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
        action       = { type = "expire" }
      },
    ]
  })
}
