# What the box may do: be managed by SSM, pull its image, read its own secrets, write its backups.
# Nothing else — no wildcards on resources the design does not name.

data "aws_caller_identity" "current" {}

resource "aws_iam_role" "instance" {
  name = "insight-bot-instance"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Session Manager (the only way in) plus the CloudWatch agent's read of its own config.
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "instance" {
  # No ECR statements: the image comes from GHCR with a read-only token kept in SSM below
  # (COST-PLAN.md). The box's only AWS rights are its own parameters and its own backups.
  statement {
    sid       = "ReadOwnSecrets"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_parameter_prefix}/*"]
  }

  statement {
    sid       = "DecryptSecureStrings"
    actions   = ["kms:Decrypt"]
    resources = ["*"] # the account's aws/ssm key; scoped by the condition below
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }

  statement {
    sid       = "WriteAndReadOwnBackups" # read as well: the restore drill runs from the box
    actions   = ["s3:PutObject", "s3:GetObject", "s3:ListBucket", "s3:GetObjectVersion", "s3:ListBucketVersions"]
    resources = [aws_s3_bucket.backups.arn, "${aws_s3_bucket.backups.arn}/*"]
  }
}

resource "aws_iam_role_policy" "instance" {
  name   = "insight-bot-instance"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.instance.json
}

resource "aws_iam_instance_profile" "insight_bot" {
  name = "insight-bot-instance"
  role = aws_iam_role.instance.name
}

# ---------------------------------------------------------------------------------------------
# The deploy role GitHub Actions assumes (OIDC, no long-lived keys). Created only when the user
# supplies their OIDC provider ARN and the repo subject; otherwise the deploy job authenticates
# some other way and this stays absent.
# ---------------------------------------------------------------------------------------------
locals {
  deploy_role_enabled = var.github_oidc_provider_arn != "" && var.deploy_role_github_sub != ""
}

data "aws_iam_policy_document" "deploy_assume" {
  count = local.deploy_role_enabled ? 1 : 0

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [var.deploy_role_github_sub]
    }
  }
}

data "aws_iam_policy_document" "deploy" {
  count = local.deploy_role_enabled ? 1 : 0

  # The image is pushed to GHCR with GitHub's own token, so CI needs no AWS rights for the build.
  # Its AWS role exists for one verb: run the deploy script on this one instance.
  statement {
    sid     = "RunDeployCommand"
    actions = ["ssm:SendCommand"]
    resources = [
      "arn:aws:ssm:${var.region}::document/AWS-RunShellScript",
      aws_instance.insight_bot.arn,
    ]
  }

  statement {
    sid       = "ReadCommandResult"
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
    resources = ["*"] # command ids are not known in advance
  }
}

resource "aws_iam_role" "deploy" {
  count              = local.deploy_role_enabled ? 1 : 0
  name               = "insight-bot-deploy"
  assume_role_policy = data.aws_iam_policy_document.deploy_assume[0].json
}

resource "aws_iam_role_policy" "deploy" {
  count  = local.deploy_role_enabled ? 1 : 0
  name   = "insight-bot-deploy"
  role   = aws_iam_role.deploy[0].id
  policy = data.aws_iam_policy_document.deploy[0].json
}
