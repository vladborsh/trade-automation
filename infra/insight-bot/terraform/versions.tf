# IB-013 — insight-bot hosting (design §7, D14). Terraform chosen over CDK: the whole stack is a
# handful of resources, and a reviewer can read the plan without running Node.
#
# NOTHING HERE HAS BEEN APPLIED. No AWS resource exists yet: the user's go-ahead is pending
# (tasks/insight-bot.jsonl IB-013, Tech Lead note 2026-09-28).
#
# State stays local until the user approves the stack; moving it to S3 needs a bucket, which is
# itself an AWS resource — see backend.tf.example.
terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
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
