output "artifact_table_name" {
  description = "DynamoDB artifact table name"
  value       = aws_dynamodb_table.artifacts.name
}

output "artifact_table_arn" {
  description = "DynamoDB artifact table ARN"
  value       = aws_dynamodb_table.artifacts.arn
}

output "writer_execution_role_arn" {
  description = "IAM role ARN for Lambda/Step Functions runtime"
  value       = aws_iam_role.writer_execution.arn
}

output "stage_lambda_arns" {
  description = "ARNs for stage Lambda handlers"
  value       = { for key, fn in aws_lambda_function.stage_handlers : key => fn.arn }
}

output "state_machine_arn" {
  description = "Step Functions state machine ARN"
  value       = aws_sfn_state_machine.writer_workflow.arn
}

output "alarm_names" {
  description = "CloudWatch alarm names for workflow and stage Lambdas"
  value = {
    stepfunctions_failed = aws_cloudwatch_metric_alarm.stepfunctions_executions_failed.alarm_name
    lambda_errors        = [for alarm in aws_cloudwatch_metric_alarm.lambda_errors : alarm.alarm_name]
  }
}

output "operations_dashboard_name" {
  description = "CloudWatch dashboard name for workflow operations"
  value       = var.dashboard_enabled ? aws_cloudwatch_dashboard.operations[0].dashboard_name : null
}

output "monthly_budget_name" {
  description = "Optional AWS Budget name when monthly budget guardrail is enabled"
  value       = var.monthly_budget_limit_usd > 0 ? aws_budgets_budget.monthly_cost[0].name : null
}

output "application_env" {
  description = "Environment values to apply to app runtime"
  value = {
    AWS_REGION          = var.aws_region
    ARTIFACT_STORE_MODE = "dynamodb"
    ARTIFACT_DDB_TABLE  = aws_dynamodb_table.artifacts.name
    MODEL_FOUNDRY       = var.model_foundry
    MODEL_GHOSTWRITER   = var.model_ghostwriter
    MODEL_COMPRESSION   = var.model_compression
    MODEL_CONTINUITY    = var.model_continuity
    MODEL_STYLE         = var.model_style
    MODEL_EVALUATOR     = var.model_evaluator
  }
}

output "supervisor_api_lambda_arn" {
  description = "Supervisor API Lambda ARN when enabled"
  value       = var.enable_supervisor_api ? aws_lambda_function.supervisor_api[0].arn : null
}

output "supervisor_api_url" {
  description = "Public Supervisor API Lambda URL when enabled"
  value       = var.enable_supervisor_api ? aws_lambda_function_url.supervisor_api[0].function_url : null
}
