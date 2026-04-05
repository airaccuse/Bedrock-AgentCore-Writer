# Infrastructure Notes

This folder provides deployment blueprints for AWS orchestration.

## Terraform stack

Deployable Terraform stack is available in `infra/terraform`.

What it provisions:

- DynamoDB table for persisted artifacts (`run_id` + `artifact_id` key design)
- IAM execution role for Lambda and Step Functions
- Bedrock runtime permissions constrained to configured model IDs
- Runtime skeleton Lambda handlers for each stage role
- Step Functions state machine wired to stage handlers
- CloudWatch operations dashboard for workflow and Lambda metrics
- Optional monthly AWS budget guardrail with email notifications

Operational ownership reference:

- `docs/OPERATIONS_RUNBOOK.md`

Quick deploy:

1. Change to terraform directory:

	`cd infra/terraform`

2. Copy variable example and edit values:

	`cp terraform.tfvars.example terraform.tfvars`

3. Initialize and review plan:

	`terraform init`
	`terraform plan`

Before planning/applying Lambda + Step Functions runtime updates, build the Lambda runtime bundle from source:

	`npm run build:lambda-bundle`

4. Apply:

	`terraform apply`

Use outputs to wire app env:

- `ARTIFACT_STORE_MODE=dynamodb`
- `ARTIFACT_DDB_TABLE=<output artifact_table_name>`
- `AWS_REGION=<your deployment region>`

Additional runtime outputs:

- `stage_lambda_arns`
- `state_machine_arn`
- `alarm_names`
- `operations_dashboard_name`
- `monthly_budget_name`

Run a contract-compliant Step Functions smoke execution from repo root:

- `npm run smoke:stepfunctions`
- `SMOKE_RUNS=5 npm run smoke:stepfunctions` for consecutive-run consistency checks
- `npm run smoke:stepfunctions:strict5` standardized strict canary check

For production-window strict checks, dispatch workflow:

- `.github/workflows/strict-contract-rollout.yml`

For pipeline-based test environment deployment, dispatch workflow:

- `.github/workflows/deploy-test-env.yml`

Required deploy workflow secrets:

- `AWS_ROLE_TO_ASSUME`
- `TF_STATE_BUCKET`
- `TF_STATE_LOCK_TABLE`
- `ALARM_SNS_TOPIC_ARN`
- `MODEL_FOUNDRY`
- `MODEL_GHOSTWRITER`
- `MODEL_EVALUATOR`

## Alert routing and ownership

Set `alarm_actions` in `terraform.tfvars` to route CloudWatch alarms to your SNS topic.

Example:

`alarm_actions = ["arn:aws:sns:us-east-1:123456789012:writer-alerts"]`

Ownership and escalation expectations are defined in `docs/OPERATIONS_RUNBOOK.md`.

## Budget guardrail notes

- `monthly_budget_limit_usd = 0` disables budget creation.
- If `monthly_budget_limit_usd > 0`, `budget_alert_email` must be set.
- After apply, confirm the AWS Budget email subscription so notifications are active.

## Runtime timeout tuning

- `stage_lambda_timeout_seconds` controls per-stage Lambda timeout (default `120`).
- Recommended range is `60` to `180` for live Bedrock latency variance.

## Strict contract rollout toggle

- `bedrock_strict_contracts = true` enables strict schema enforcement in deployed Lambdas.
- Keep `false` for baseline compatibility; enable during staged production rollout windows.
- Current dev trial note: strict mode canary succeeded after evaluator prompt/output hardening.

## Step Functions

State machine definition:

- `infra/step-functions/bedrock-writer-workflow.asl.json`

Map each task state to a Lambda handler:

- `NarrativeFoundry` -> planning model invocation
- `Ghostwriter` -> scene generation or rewrite
- `Compression` -> tightening pass
- `Continuity` -> canon validation pass
- `Style` -> voice conformance pass
- `Evaluator` -> weighted quality scoring
- `Rewrite` -> revision transform using evaluator directives

Terraform runtime skeleton handler package:

- `infra/terraform/lambda/index.js`

Current state:

- Terraform now packages bundled handlers from `src/runtime/lambda` via `infra/terraform/.build/runtime-bundle`.
- `infra/terraform/lambda/index.js` remains as an earlier scaffold reference.
- Terraform deployment and Step Functions smoke execution have succeeded with compiled runtime handlers.
- Live Bedrock mode smoke execution has succeeded with deployed compiled handlers.
- Step Functions execution logging and CloudWatch failure alarms are deployed.
- Stage Lambda timeout is set to 120 seconds to tolerate live Bedrock latency spikes.
- Repo-level smoke helper (`npm run smoke:stepfunctions`) is available for contract-compliant workflow checks.

Use strict JSON schema validation in every Lambda before writing artifacts.