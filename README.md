# Bedrock AgentCore Writer

Production-oriented scaffold for a multi-agent sci-fi writing ecosystem on Amazon Bedrock.

## What is included

- Agent contracts and shared envelope schema
- JSON schema pack for validation and orchestration gates
- Prompt templates for Foundry, Ghostwriter, and Evaluator
- TypeScript orchestration stubs for routing and revision loops
- Rubric and quality-gate policy
- Detailed deployment plan in docs/DEPLOYMENT_PLAN.md
- Operations ownership and escalation runbook in docs/OPERATIONS_RUNBOOK.md

## Proposed agent set

- `NARRATIVE_FOUNDRY`
- `GHOSTWRITER`
- `COMPRESSION`
- `CONTINUITY`
- `STYLE`
- `EVALUATOR`

## Quick start

1. Install dependencies from repo root:

   `npm install`

2. Validate schema files:

   `npm run validate:schemas`

3. Run adapter regression checks:

   `npm run test:adapters`

4. Run workflow integration checks:

   `npm run test:workflow`

5. Run the local workflow simulation:

   `npm run dev`

6. Run AWS Step Functions smoke execution (contract-compliant envelope):

   `npm run smoke:stepfunctions`

   Optional batch mode for consistency checks:

   `SMOKE_RUNS=5 npm run smoke:stepfunctions`

   Standard strict canary command:

   `npm run smoke:stepfunctions:strict5`

## Runtime configuration

- `USE_LOCAL_STUB_ROUTER=true` keeps model calls local and deterministic.
- `USE_LOCAL_STUB_ROUTER=false` enables Bedrock calls for Foundry, Ghostwriter, and Evaluator.
- `BEDROCK_STRICT_CONTRACTS=true` disables legacy response adapters and enforces raw schema compliance.
- `ARTIFACT_STORE_MODE=local` persists artifacts to the local `artifacts/` folder.
- `ARTIFACT_STORE_MODE=dynamodb` persists artifacts to DynamoDB using `ARTIFACT_DDB_TABLE`.

## Runtime preflight

Run a service preflight before workflow execution:

- `npm run verify:runtime`

This checks model identifiers (foundation model or inference profile) and verifies DynamoDB table status when using DynamoDB artifact mode.

Set `VERIFY_RUNTIME_MODE=offline` to run config-only checks without AWS API calls (useful for CI).

Set `VERIFY_RUNTIME_WRITE_TEST=true` (live mode only) to run a DynamoDB write/delete probe.

## CI checks

GitHub Actions workflow is defined in `.github/workflows/ci.yml` and runs:

- `npm run validate:schemas`
- `npm run build`
- `npm run test:adapters`
- `npm run test:workflow`
- `npm run verify:runtime` with `VERIFY_RUNTIME_MODE=offline`

Manual live verification workflow is available in [.github/workflows/live-verify.yml](.github/workflows/live-verify.yml).

Required repository secrets for live verification:

- `AWS_ROLE_TO_ASSUME` (OIDC role ARN with Bedrock + DynamoDB read access)
- `MODEL_FOUNDRY`
- `MODEL_GHOSTWRITER`
- `MODEL_EVALUATOR`
- `ARTIFACT_DDB_TABLE`

To run live verification:

1. Open Actions tab and choose Live Runtime Verify.
2. Click Run workflow and select region.
3. Review job output for Bedrock model/inference-profile and DynamoDB checks.

Manual end-to-end smoke workflow is available in [.github/workflows/live-e2e-smoke.yml](.github/workflows/live-e2e-smoke.yml).

Strict contract rollout gate workflow is available in [.github/workflows/strict-contract-rollout.yml](.github/workflows/strict-contract-rollout.yml).

Test environment deploy workflow is available in [.github/workflows/deploy-test-env.yml](.github/workflows/deploy-test-env.yml).

The strict rollout gate workflow runs build, live runtime verification, and `npm run dev` against Bedrock + DynamoDB.

The deploy-test-env workflow runs build and Lambda bundle packaging, Terraform init/plan/apply with remote state, live runtime verification with write probe, and post-deploy Step Functions smoke.

Notes:

- It can incur Bedrock/DynamoDB cost.
- It supports `BEDROCK_STRICT_CONTRACTS` as a manual input when dispatching.
- The strict rollout gate always runs with `BEDROCK_STRICT_CONTRACTS=true` plus runtime write probe.

Required repository secrets for deploy-test-env workflow:

- `AWS_ROLE_TO_ASSUME`
- `TF_STATE_BUCKET`
- `TF_STATE_LOCK_TABLE`
- `ALARM_SNS_TOPIC_ARN`
- `MODEL_FOUNDRY`
- `MODEL_GHOSTWRITER`
- `MODEL_EVALUATOR`

Optional model override secrets for deploy-test-env workflow:

- `MODEL_COMPRESSION`
- `MODEL_CONTINUITY`
- `MODEL_STYLE`

## Next integration step

Hook `src/orchestrator/workflow.ts` into your AWS runtime (Lambda + Step Functions or equivalent), and wire each role in `AgentRouter` to Bedrock model calls.

Runtime skeleton files now available:

- `src/runtime/stepFunctions/types.ts`
- `src/runtime/lambda/shared.ts`
- `src/runtime/lambda/handlers.ts`