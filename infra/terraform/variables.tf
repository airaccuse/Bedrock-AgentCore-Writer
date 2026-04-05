variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name prefix"
  type        = string
  default     = "bedrock-agentcore-writer"
}

variable "environment" {
  description = "Environment suffix (dev, stage, prod)"
  type        = string
  default     = "dev"
}

variable "artifact_table_name" {
  description = "DynamoDB table for persisted artifacts"
  type        = string
  default     = ""
}

variable "bedrock_model_ids" {
  description = "Allowed Bedrock foundation model IDs for invoke permissions"
  type        = list(string)
  default = [
    "us.anthropic.claude-sonnet-4-6",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0"
  ]
}

variable "model_foundry" {
  description = "Bedrock model/profile id for Narrative Foundry"
  type        = string
  default     = "us.anthropic.claude-sonnet-4-6"
}

variable "model_ghostwriter" {
  description = "Bedrock model/profile id for Ghostwriter"
  type        = string
  default     = "us.anthropic.claude-sonnet-4-6"
}

variable "model_compression" {
  description = "Bedrock model/profile id for Compression"
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "model_continuity" {
  description = "Bedrock model/profile id for Continuity"
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "model_style" {
  description = "Bedrock model/profile id for Style"
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "model_evaluator" {
  description = "Bedrock model/profile id for Evaluator"
  type        = string
  default     = "us.anthropic.claude-sonnet-4-6"
}

variable "max_revisions" {
  description = "Maximum rewrite iterations for workflow"
  type        = number
  default     = 2
}

variable "stage_lambda_timeout_seconds" {
  description = "Timeout in seconds for each stage Lambda function"
  type        = number
  default     = 120

  validation {
    condition     = var.stage_lambda_timeout_seconds >= 30 && var.stage_lambda_timeout_seconds <= 900
    error_message = "stage_lambda_timeout_seconds must be between 30 and 900 seconds."
  }
}

variable "use_local_stub_router" {
  description = "Whether deployed Lambda handlers use local stub router instead of live Bedrock"
  type        = bool
  default     = false
}

variable "bedrock_strict_contracts" {
  description = "Whether deployed Lambda handlers enforce strict Bedrock schema contracts"
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "CloudWatch log retention for Lambda and Step Functions logs"
  type        = number
  default     = 14
}

variable "alarm_actions" {
  description = "Optional list of SNS topic ARNs or other alarm action ARNs"
  type        = list(string)
  default     = []
}

variable "dashboard_enabled" {
  description = "Whether to create a CloudWatch dashboard for workflow operations"
  type        = bool
  default     = true
}

variable "monthly_budget_limit_usd" {
  description = "Optional monthly cost budget in USD for this stack (0 disables budget resource)"
  type        = number
  default     = 0

  validation {
    condition     = var.monthly_budget_limit_usd >= 0
    error_message = "monthly_budget_limit_usd must be 0 or a positive number."
  }
}

variable "budget_alert_email" {
  description = "Optional email recipient for budget threshold alerts"
  type        = string
  default     = ""

  validation {
    condition = (
      var.monthly_budget_limit_usd == 0 ||
      length(trimspace(var.budget_alert_email)) > 0
    )
    error_message = "budget_alert_email must be set when monthly_budget_limit_usd is greater than 0."
  }
}

variable "tags" {
  description = "Additional tags to apply"
  type        = map(string)
  default     = {}
}

variable "enable_supervisor_api" {
  description = "Whether to deploy the Supervisor API Lambda endpoint"
  type        = bool
  default     = true
}

variable "supervisor_cors_allowed_origins" {
  description = "Allowed origins for Supervisor API Lambda URL CORS"
  type        = list(string)
  default     = ["*"]
}
