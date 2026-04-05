# Operations Runbook

## Purpose

This runbook defines alert-routing ownership, escalation flow, and budget-alert handling for the Bedrock AgentCore Writer deployment.

## Scope

- Step Functions workflow failure alarms
- Per-stage Lambda error alarms
- Monthly AWS budget threshold alerts (optional)

## Ownership Model

- Primary on-call: Platform owner (`Owner` tag in Terraform `tags` map)
- Secondary on-call: Application owner (repo maintainer)
- Escalation authority: Engineering lead

If the owner assignments change, update both:

- `infra/terraform/terraform.tfvars`
- This runbook

## Required Terraform Inputs

- `alarm_actions`: SNS topic ARN list used by CloudWatch alarms
- `monthly_budget_limit_usd`: monthly budget threshold (0 disables budget)
- `budget_alert_email`: budget notification recipient (required when budget > 0)

## Alert Routing Setup

1. Create an SNS topic for runtime alerts.
2. Subscribe on-call destinations (email, ChatOps bridge, paging integration).
3. Confirm subscriptions.
4. Set `alarm_actions` in `infra/terraform/terraform.tfvars`.
5. Apply Terraform and verify alarm actions in CloudWatch.

Example:

```hcl
alarm_actions = [
  "arn:aws:sns:us-east-1:123456789012:writer-alerts"
]
```

## Budget Guardrail Setup

1. Set `monthly_budget_limit_usd` to a non-zero value.
2. Set `budget_alert_email` to a monitored mailbox.
3. Apply Terraform.
4. Confirm AWS Budget notification subscription from the email inbox.

Example:

```hcl
monthly_budget_limit_usd = 50
budget_alert_email = "writer-alerts@example.com"
```

## Triage Playbook

### Step Functions failure alarm

1. Open the latest execution in Step Functions.
2. Inspect `error` and `cause` from failed state output.
3. Correlate with the CloudWatch Logs group `/aws/vendedlogs/states/<workflow-name>`.
4. Check the corresponding stage Lambda logs.
5. If failure is input-contract related, validate envelope fields (`runId`, `chapterId`, `sceneId`, `revision`, `maxRevisions`).

### Lambda stage error alarm

1. Identify failing function from alarm dimensions.
2. Review recent invocation logs and stack trace.
3. Determine class of issue:
   - Contract/validation regression
   - Bedrock invocation/permission issue
   - DynamoDB persistence issue
4. Resolve and rerun a smoke execution.

### Budget alert (80% forecasted or 100% actual)

1. Confirm whether spend spike is expected (load test, migration, or deployment window).
2. If unexpected, throttle non-essential smoke runs and inspect Bedrock call volume.
3. Evaluate model mix and shift eligible stages to lower-cost models.
4. Notify stakeholders with estimated month-end impact and mitigation plan.

## Escalation Targets

- P1 (production outage, repeated workflow failure): page engineering lead immediately.
- P2 (intermittent failures, degraded quality): notify within business hours and track in issue queue.
- P3 (budget threshold warning): notify owners and monitor trends daily.

## Verification Checklist After Any Terraform Apply

- CloudWatch dashboard loads and shows Step Functions + Lambda error metrics.
- `alarm_actions` are attached to workflow and Lambda alarms.
- Step Functions smoke execution succeeds with contract-compliant input envelope.
- If budget enabled, budget exists and notifications are configured.
