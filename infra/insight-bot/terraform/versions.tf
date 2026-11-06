# IB-013 — insight-bot hosting (design §7, D14). Terraform chosen over CDK: the whole stack is a
# handful of resources, and a reviewer can read the plan without running Node.
#
# IB-013's apply ran partially (2026-10-07) and left five resources live; IB-073 adopts them
# (imports.tf) into state kept in S3 (backend.tf). LIVE-RESOURCES.md lists them.
terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    # IB-150: zips the alarm Lambda's one source file at plan time (alarms.tf).
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "insight-bot"
      ManagedBy = "terraform"
      Component = "stage-0"
    }
  }
}
