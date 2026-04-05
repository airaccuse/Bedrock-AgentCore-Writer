data "aws_partition" "current" {}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "writer_assume_role" {
  statement {
    sid     = "AllowLambdaAndStepFunctionsAssume"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com", "states.amazonaws.com"]
    }
  }
}

locals {
  table_name = var.artifact_table_name != "" ? var.artifact_table_name : "${var.project_name}-artifacts-${var.environment}"

  model_arns = flatten([
    for model_id in var.bedrock_model_ids : [
      "arn:${data.aws_partition.current.partition}:bedrock:${var.aws_region}::foundation-model/${model_id}",
      "arn:${data.aws_partition.current.partition}:bedrock:${var.aws_region}::foundation-model/${trimprefix(trimprefix(model_id, "us."), "global.")}",
      "arn:${data.aws_partition.current.partition}:bedrock:*::foundation-model/${model_id}",
      "arn:${data.aws_partition.current.partition}:bedrock:*::foundation-model/${trimprefix(trimprefix(model_id, "us."), "global.")}",
      "arn:${data.aws_partition.current.partition}:bedrock:*:${data.aws_caller_identity.current.account_id}:inference-profile/${model_id}",
      "arn:${data.aws_partition.current.partition}:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:inference-profile/${model_id}"
    ]
  ])

  common_tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags
  )

  lambda_source_dir = "${path.module}/.build/runtime-bundle"
  lambda_zip_path   = "${path.module}/.build/runtime-bundle.zip"

  stage_roles = {
    narrative_foundry = { role = "NARRATIVE_FOUNDRY", handler = "dist/runtime/lambda/handlers.narrativeFoundryHandler" }
    ghostwriter       = { role = "GHOSTWRITER", handler = "dist/runtime/lambda/handlers.ghostwriterHandler" }
    compression       = { role = "COMPRESSION", handler = "dist/runtime/lambda/handlers.compressionHandler" }
    continuity        = { role = "CONTINUITY", handler = "dist/runtime/lambda/handlers.continuityHandler" }
    style             = { role = "STYLE", handler = "dist/runtime/lambda/handlers.styleHandler" }
    evaluator         = { role = "EVALUATOR", handler = "dist/runtime/lambda/handlers.evaluatorHandler" }
  }

  dashboard_name = "${var.project_name}-operations-${var.environment}"

  lambda_log_group_arns = [
    for stage_name in keys(local.stage_roles) :
    "arn:${data.aws_partition.current.partition}:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${var.project_name}-${stage_name}-${var.environment}"
  ]
}

data "archive_file" "runtime_skeleton" {
  type        = "zip"
  source_dir  = local.lambda_source_dir
  output_path = local.lambda_zip_path
}

resource "aws_dynamodb_table" "artifacts" {
  name         = local.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "run_id"
  range_key    = "artifact_id"

  attribute {
    name = "run_id"
    type = "S"
  }

  attribute {
    name = "artifact_id"
    type = "S"
  }

  tags = local.common_tags
}

resource "aws_iam_role" "writer_execution" {
  name               = "${var.project_name}-execution-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.writer_assume_role.json
  tags               = local.common_tags
}

resource "aws_lambda_function" "stage_handlers" {
  for_each = local.stage_roles

  function_name = "${var.project_name}-${each.key}-${var.environment}"
  role          = aws_iam_role.writer_execution.arn
  runtime       = "nodejs20.x"
  handler       = each.value.handler
  timeout       = var.stage_lambda_timeout_seconds
  memory_size   = 512

  filename         = data.archive_file.runtime_skeleton.output_path
  source_code_hash = data.archive_file.runtime_skeleton.output_base64sha256

  environment {
    variables = {
      STAGE_ROLE              = each.value.role
      USE_LOCAL_STUB_ROUTER   = tostring(var.use_local_stub_router)
      ARTIFACT_STORE_MODE     = "dynamodb"
      ARTIFACT_DDB_TABLE      = aws_dynamodb_table.artifacts.name
      BEDROCK_STRICT_CONTRACTS = tostring(var.bedrock_strict_contracts)
      MODEL_FOUNDRY           = var.model_foundry
      MODEL_GHOSTWRITER       = var.model_ghostwriter
      MODEL_COMPRESSION       = var.model_compression
      MODEL_CONTINUITY        = var.model_continuity
      MODEL_STYLE             = var.model_style
      MODEL_EVALUATOR         = var.model_evaluator
      QUALITY_GATE_MIN_OVERALL   = "86"
      QUALITY_GATE_MIN_CATEGORY  = "70"
      QUALITY_GATE_MIN_COHERENCE = "80"
      QUALITY_GATE_MIN_SCENE_CRAFT = "80"
    }
  }

  tags = local.common_tags
}

data "aws_iam_policy_document" "writer_execution" {
  statement {
    sid    = "AllowLambdaCloudWatchLogWrites"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = [for arn in local.lambda_log_group_arns : "${arn}:*"]
  }

  statement {
    sid    = "AllowStepFunctionsLogDelivery"
    effect = "Allow"
    actions = [
      "logs:CreateLogDelivery",
      "logs:GetLogDelivery",
      "logs:UpdateLogDelivery",
      "logs:DeleteLogDelivery",
      "logs:ListLogDeliveries",
      "logs:PutResourcePolicy",
      "logs:DescribeResourcePolicies",
      "logs:DescribeLogGroups"
    ]
    resources = ["*"]
  }

  statement {
    sid    = "AllowArtifactTableWrites"
    effect = "Allow"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:Query"
    ]
    resources = [aws_dynamodb_table.artifacts.arn]
  }

  statement {
    sid    = "AllowBedrockRuntimeInvocations"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
      "bedrock:Converse",
      "bedrock:ConverseStream"
    ]
    resources = local.model_arns
  }

  statement {
    sid    = "AllowLambdaInvokeForStateMachine"
    effect = "Allow"
    actions = [
      "lambda:InvokeFunction"
    ]
    resources = [for fn in aws_lambda_function.stage_handlers : fn.arn]
  }
}

resource "aws_iam_role_policy" "writer_execution" {
  name   = "${var.project_name}-execution-policy-${var.environment}"
  role   = aws_iam_role.writer_execution.id
  policy = data.aws_iam_policy_document.writer_execution.json
}

resource "aws_sfn_state_machine" "writer_workflow" {
  name     = "${var.project_name}-workflow-${var.environment}"
  role_arn = aws_iam_role.writer_execution.arn
  depends_on = [aws_cloudwatch_log_resource_policy.stepfunctions_delivery]

  logging_configuration {
    include_execution_data = true
    level                  = "ALL"
    log_destination        = "${aws_cloudwatch_log_group.stepfunctions_logs.arn}:*"
  }

  definition = jsonencode({
    Comment = "Bedrock AgentCore Writer workflow (Terraform skeleton)"
    StartAt = "NarrativeFoundry"
    States = {
      NarrativeFoundry = {
        Type       = "Task"
        Resource   = "arn:aws:states:::lambda:invoke"
        OutputPath = "$.Payload"
        Parameters = {
          FunctionName = aws_lambda_function.stage_handlers["narrative_foundry"].arn
          "Payload.$" = "$"
        }
        Next = "Ghostwriter"
      }
      Ghostwriter = {
        Type       = "Task"
        Resource   = "arn:aws:states:::lambda:invoke"
        OutputPath = "$.Payload"
        Parameters = {
          FunctionName = aws_lambda_function.stage_handlers["ghostwriter"].arn
          "Payload.$" = "$.envelope"
        }
        Next = "Compression"
      }
      Compression = {
        Type       = "Task"
        Resource   = "arn:aws:states:::lambda:invoke"
        OutputPath = "$.Payload"
        Parameters = {
          FunctionName = aws_lambda_function.stage_handlers["compression"].arn
          "Payload.$" = "$.envelope"
        }
        Next = "Continuity"
      }
      Continuity = {
        Type       = "Task"
        Resource   = "arn:aws:states:::lambda:invoke"
        OutputPath = "$.Payload"
        Parameters = {
          FunctionName = aws_lambda_function.stage_handlers["continuity"].arn
          "Payload.$" = "$.envelope"
        }
        Next = "Style"
      }
      Style = {
        Type       = "Task"
        Resource   = "arn:aws:states:::lambda:invoke"
        OutputPath = "$.Payload"
        Parameters = {
          FunctionName = aws_lambda_function.stage_handlers["style"].arn
          "Payload.$" = "$.envelope"
        }
        Next = "Evaluator"
      }
      Evaluator = {
        Type       = "Task"
        Resource   = "arn:aws:states:::lambda:invoke"
        OutputPath = "$.Payload"
        Parameters = {
          FunctionName = aws_lambda_function.stage_handlers["evaluator"].arn
          "Payload.$" = "$.envelope"
        }
        Next = "PassOrRewrite"
      }
      PassOrRewrite = {
        Type = "Choice"
        Choices = [
          {
            Variable      = "$.ok"
            BooleanEquals = false
            Next          = "WorkflowFailed"
          },
          {
            Variable                  = "$.envelope.revision"
            NumericGreaterThanEqualsPath = "$.envelope.maxRevisions"
            Next                      = "Success"
          },
          {
            And = [
              {
                Variable  = "$.output.decision"
                IsPresent = true
              },
              {
                Variable     = "$.output.decision"
                StringEquals = "PASS"
              }
            ]
            Next = "Success"
          }
        ]
        Default = "Ghostwriter"
      }
      WorkflowFailed = {
        Type  = "Fail"
        Error = "StageInvocationFailed"
        Cause = "A workflow stage returned ok=false. Inspect stage output and Lambda logs."
      }
      Success = {
        Type = "Succeed"
      }
    }
  })

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "stepfunctions_logs" {
  name              = "/aws/vendedlogs/states/${var.project_name}-workflow-${var.environment}"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_resource_policy" "stepfunctions_delivery" {
  policy_name = "${var.project_name}-stepfunctions-logs-${var.environment}"
  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowStepFunctionsLogDelivery"
        Effect = "Allow"
        Principal = {
          Service = "states.amazonaws.com"
        }
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.stepfunctions_logs.arn}:*"
      }
    ]
  })
}

resource "aws_cloudwatch_metric_alarm" "stepfunctions_executions_failed" {
  alarm_name          = "${var.project_name}-workflow-executions-failed-${var.environment}"
  alarm_description   = "Alarm when Step Functions workflow has failed executions"
  namespace           = "AWS/States"
  metric_name         = "ExecutionsFailed"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_actions
  ok_actions          = var.alarm_actions

  dimensions = {
    StateMachineArn = aws_sfn_state_machine.writer_workflow.arn
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = aws_lambda_function.stage_handlers

  alarm_name          = "${each.value.function_name}-errors-${var.environment}"
  alarm_description   = "Alarm when Lambda function has invocation errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_actions
  ok_actions          = var.alarm_actions

  dimensions = {
    FunctionName = each.value.function_name
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_dashboard" "operations" {
  count          = var.dashboard_enabled ? 1 : 0
  dashboard_name = local.dashboard_name

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 24
        height = 6
        properties = {
          title   = "Step Functions Executions"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 60
          metrics = [
            ["AWS/States", "ExecutionsSucceeded", "StateMachineArn", aws_sfn_state_machine.writer_workflow.arn],
            ["AWS/States", "ExecutionsFailed", "StateMachineArn", aws_sfn_state_machine.writer_workflow.arn],
            ["AWS/States", "ExecutionsTimedOut", "StateMachineArn", aws_sfn_state_machine.writer_workflow.arn]
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 24
        height = 6
        properties = {
          title   = "Lambda Errors By Stage"
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          period  = 60
          metrics = [
            for fn in aws_lambda_function.stage_handlers : ["AWS/Lambda", "Errors", "FunctionName", fn.function_name]
          ]
        }
      }
    ]
  })
}

resource "aws_budgets_budget" "monthly_cost" {
  count = var.monthly_budget_limit_usd > 0 ? 1 : 0

  name         = "${var.project_name}-monthly-${var.environment}"
  budget_type  = "COST"
  limit_unit   = "USD"
  limit_amount = tostring(var.monthly_budget_limit_usd)
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Project$${var.project_name}"]
  }

  dynamic "notification" {
    for_each = length(var.budget_alert_email) > 0 ? [1] : []
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = 80
      threshold_type             = "PERCENTAGE"
      notification_type          = "FORECASTED"
      subscriber_email_addresses = [var.budget_alert_email]
    }
  }

  dynamic "notification" {
    for_each = length(var.budget_alert_email) > 0 ? [1] : []
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = 100
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.budget_alert_email]
    }
  }
}
