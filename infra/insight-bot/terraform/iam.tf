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
  # ECR design E5: pull only, from the one repository. GetAuthorizationToken cannot be scoped.
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid       = "PullOwnImage"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = [aws_ecr_repository.insight_bot.arn]
  }

  statement {
    sid     = "ReadOwnSecrets"
    actions = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    # GetParametersByPath is authorised against the PATH itself (parameter/insight-bot), not the
    # parameters under it, so the path needs its own ARN — without it render-env.sh is denied
    # (found by the first deploy, IB-083).
    resources = [
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_parameter_prefix}",
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_parameter_prefix}/*",
    ]
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

  # IB-150: IB-149's metric publisher (alarms.tf). PutMetricData has no resource ARN for classic
  # metrics, so "*", fenced by the namespace: the box can write InsightBot/* and nothing else,
  # never AWS/* and never another project's namespace.
  statement {
    sid       = "PublishMetrics"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = [local.ns]
    }
  }

  # IB-150: docker's awslogs driver (IB-149), into the three groups alarms.tf creates. The driver
  # runs with awslogs-create-group=false, so no CreateLogGroup.
  statement {
    sid       = "ShipLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [for g in aws_cloudwatch_log_group.box : "${g.arn}:*"]
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
# CI's identity (ECR design E6): GitHub's OIDC provider and the role a workflow on master assumes.
# No long-lived keys. Only one provider per URL may exist in an account; if one already exists it
# is imported (imports.tf), not created twice.
# ---------------------------------------------------------------------------------------------
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # No thumbprint_list: AWS validates GitHub's certificate itself for this provider.
}

data "aws_iam_policy_document" "deploy_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
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
  # E8: push the image (skipping a tag that already exists), name it in SSM, deploy it.
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "PushOwnImage"
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage", "ecr:DescribeImages",
    ]
    resources = [aws_ecr_repository.insight_bot.arn]
  }

  # E10: the tag the box deploys. This one parameter only.
  statement {
    sid       = "NameTheImage"
    actions   = ["ssm:PutParameter", "ssm:GetParameter"]
    resources = ["arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${var.ssm_parameter_prefix}/IMAGE_TAG"]
  }

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
  name               = "insight-bot-deploy"
  assume_role_policy = data.aws_iam_policy_document.deploy_assume.json
}

resource "aws_iam_role_policy" "deploy" {
  name   = "insight-bot-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
