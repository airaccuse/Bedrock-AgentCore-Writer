# Deployment Plan

## Purpose

This plan maps the deployment path from local baseline to production-grade operation for the Bedrock AgentCore Writer system.

## Current status snapshot

- Repository scaffold complete.
- Core schemas and contract validation in place.
- Bedrock live routing implemented for Foundry, Ghostwriter, Evaluator.
- Artifact persistence implemented for local file mode and DynamoDB mode.
- Terraform stack deployed for DynamoDB and IAM execution role.
- Runtime preflight checks implemented (offline and live).
- CI workflow added for schema and build validation.
- Manual live verify and live smoke workflows added.
- Editorial chain execution implemented for Compression, Continuity, and Style.
- Adapter regression checks added for parser and evaluator normalization behavior.
- Strict-mode regression checks added to assert legacy payload rejection under raw schema validation.
- Deterministic workflow integration harness added for role order and artifact persistence coverage.
- Lambda/Step Functions runtime package skeleton added with stage handler scaffolds and shared envelope/error mapping.
- Terraform wiring added for stage Lambda resources and Step Functions workflow skeleton.
- Terraform apply completed for stage Lambdas and state machine; AWS smoke execution succeeded.
- Observability baseline deployed: Step Functions execution logging and CloudWatch failure alarms.
- Post-observability smoke execution succeeded.
- Compiled runtime handlers from `src/runtime/lambda` deployed to Lambda via bundle packaging.
- Runtime-bundle smoke execution succeeded on Step Functions.
- Live Bedrock state-machine smoke execution succeeded with compiled runtime handlers.
- Operations dashboard and optional budget guardrail Terraform support added.
- Operations dashboard deployed via Terraform apply.
- Post-dashboard smoke execution succeeded with full workflow envelope input.
- Operational runbook added for alarm routing ownership and escalation policy.
- Terraform variable validation added to enforce actionable budget alert configuration.
- Strict-contract rollout gate workflow added for production-window validation.
- Scripted Step Functions smoke command added with contract-compliant default envelope.
- Stage Lambda timeout increased from 60s to 120s after live timeout incident.
- Smoke script validated successfully against deployed state machine post-timeout update.
- Terraform timeout is now configurable via stage_lambda_timeout_seconds.
- Terraform strict-contract toggle added via bedrock_strict_contracts.
- Dev strict-mode rollout validated after evaluator prompt hardening and runtime redeploy.
- Strict-mode consistency check passed: 5/5 consecutive Step Functions smoke executions succeeded.
- Standard strict canary alias validated: npm run smoke:stepfunctions:strict5 -> 5/5 succeeded.
- IAM least-privilege hardening completed for CloudWatch Logs by splitting Lambda log writes from Step Functions log-delivery permissions and scoping Lambda writes to stage log groups.
- Strict-mode production-window drill completed: rollback to non-strict and re-enable to strict both succeeded with smoke verification.
- Pipeline-based test environment deployment workflow added for Terraform plan/apply plus post-deploy live verification and smoke checks.

## Phase 0: Foundation and contracts

Goal:
- Ensure strict data contracts and quality gate policy are enforceable.

Scope:
- Schema pack quality checks.
- Contract type definitions and runtime validators.
- Prompt baselines for Foundry, Ghostwriter, Evaluator.

Exit criteria:
- Schema validation passes on every commit.
- All contract changes are reflected in both schema and TypeScript types.

Status:
- Completed.

## Phase 1: Core live runtime

Goal:
- Run iterative rewrite workflow end-to-end on Bedrock with persisted artifacts.

Scope:
- Bedrock router invocation path.
- Evaluator rewrite loop.
- Local and DynamoDB artifact stores.
- Runtime preflight verification.

Exit criteria:
- Live workflow run succeeds from local environment.
- Artifacts are persisted for each iteration.
- Preflight checks pass in both offline and live modes.

Status:
- Completed.

## Phase 2: Infrastructure as code baseline

Goal:
- Deploy minimum required cloud resources reproducibly.

Scope:
- Terraform for DynamoDB table and IAM execution role policy.
- Bedrock invocation permissions scoped to configured model or profile IDs.

Exit criteria:
- Terraform apply produces active table and usable execution role.
- Runtime app uses Terraform outputs without manual console drift.

Status:
- Completed.

## Phase 3: CI and release safety

Goal:
- Prevent regressions before merge and support on-demand cloud checks.

Scope:
- Pull request CI checks.
- Manual live verify workflow.
- Manual live end-to-end smoke workflow.

Exit criteria:
- PR validation is green on schema, build, and offline runtime verification.
- Maintainers can run manual live checks using OIDC and repository secrets.

Status:
- Completed.

## Phase 4: Multi-agent editorial expansion

Goal:
- Promote Compression, Continuity, and Style from conceptual roles to executable stages.

Scope:
- Add runtime handlers and prompt templates for each role.
- Add schema contracts for each role output where needed.
- Integrate stages into workflow orchestration with per-stage artifact persistence.

Exit criteria:
- Each editorial stage has enforceable JSON output contract.
- Workflow can execute full chain with evaluator-gated rewrites.

Status:
- Completed.

## Phase 5: Step Functions and Lambda deployment

Goal:
- Move orchestration from local process execution to AWS-managed workflow runtime.

Scope:
- Lambda handlers for each stage.
- State machine wiring with retries and failure handling.
- Structured CloudWatch logging and correlation IDs.

Exit criteria:
- State machine starts, executes, and persists artifacts successfully.
- Failure states are observable and actionable.

Status:
- Completed.

## Phase 6: Production hardening and governance

Goal:
- Improve reliability, security, observability, and cost predictability.

Scope:
- Contract adapter reduction under strict mode.
- Least-privilege IAM tightening by resource and action.
- Alarms, dashboards, and structured metrics.
- Cost guardrails and usage budgets.

Exit criteria:
- Strict mode can be enabled in production with no adapter dependency.
- Operational telemetry supports incident triage.
- Budget and cost visibility is in place.

Status:
- In progress.

## Immediate next steps mapped to the plan

1. Introduce deployable Lambda and Step Functions runtime package.
- Plan phase: Phase 5
- Deliverables:
  - Lambda entrypoints for each stage. (skeleton complete)
  - Shared event envelope and stage error mapping. (skeleton complete)
  - State machine deployment and environment wiring. (terraform wiring complete)
  - Replace placeholder Lambda package with compiled runtime handlers from `src/runtime`. (complete)
  - Apply infrastructure and run live state-machine smoke execution. (complete for skeleton package)
  - Switch Lambda runtime from stub mode to live Bedrock mode and validate policy scope. (complete)

2. Add observability baseline.
- Plan phase: Phase 6
- Deliverables:
  - Structured execution logging for state-machine runs. (complete)
  - Basic alarming on execution failures. (complete)
  - Operations dashboard deployment. (complete)

3. Add deployment wiring for runtime skeleton.
- Plan phase: Phase 5
- Deliverables:
  - Terraform resources for Lambda functions and Step Functions state machine. (complete)
  - Environment variable wiring for each handler. (complete)

4. Replace deployed placeholder Lambda package with bundled runtime handlers.
- Plan phase: Phase 5
- Deliverables:
  - Build/package compiled handlers from `src/runtime/lambda`. (complete)
  - Update Terraform Lambda code source from scaffold package to compiled runtime bundle. (complete)
  - Re-run apply and smoke execution. (complete)

5. Expand production hardening and governance controls.
- Plan phase: Phase 6
- Deliverables:
  - Add dashboards and alert routing ownership for alarms. (complete)
  - Add budget/cost guardrails and runbook escalation policy. (infrastructure and runbook complete)
  - Add stricter contract conformance checks for production rollout windows. (complete in dev strict canary)

## Operational runbook pointers

- Architecture reference: docs/ARCHITECTURE.md
- Operations runbook: docs/OPERATIONS_RUNBOOK.md
- Infrastructure reference: infra/README.md
- Terraform root: infra/terraform
- CI workflow: .github/workflows/ci.yml
- Live verify workflow: .github/workflows/live-verify.yml
- Live smoke workflow: .github/workflows/live-e2e-smoke.yml
- Strict rollout workflow: .github/workflows/strict-contract-rollout.yml

## Sprint 1 exit checklist (binary)

Use this as the Sprint 1 completion gate. Every item is PASS or PENDING.

1. Workflow deployment reliability
- Gate: Step Functions + Lambda runtime deploys from Terraform and executes end-to-end.
- Status: PASS
- Evidence: Phase 5 status completed, repeated smoke success in current status snapshot.

2. Strict contract canary viability
- Gate: Strict contract mode runs successfully in deployed runtime using canary workflow checks.
- Status: PASS
- Evidence: strict rollout validation and strict5 consistency checks in current status snapshot.

3. Observability and alerting baseline
- Gate: CloudWatch logs, failure alarms, and operations dashboard are deployed and usable.
- Status: PASS
- Evidence: observability baseline, alarms, and dashboard entries in current status snapshot.

4. Cost and governance baseline
- Gate: Budget guardrail infrastructure, alert routing ownership, and escalation runbook are documented and deployable.
- Status: PASS
- Evidence: runbook and governance entries in current status snapshot and infra notes.

5. Operational smoke standardization
- Gate: A single standardized strict canary command exists and is documented.
- Status: PASS
- Evidence: npm strict5 smoke alias and docs updates.

6. Least-privilege hardening closure
- Gate: IAM policy scope is tightened to finalized production least-privilege boundaries.
- Status: PASS
- Evidence: writer execution IAM policy now scopes Lambda `logs:CreateLogStream`/`logs:PutLogEvents` to stage-specific log-group ARNs, with Step Functions log-delivery permissions isolated.

7. Production rollout drill and rollback proof
- Gate: A production-window enable/disable drill for strict mode is executed with rollback steps validated.
- Status: PASS
- Evidence: drill run completed with `bedrock_strict_contracts=false` apply (~15s) + smoke PASS, then `bedrock_strict_contracts=true` apply (~16s) + smoke PASS.

Sprint 1 completion rule:
- Sprint 1 is complete when all checklist items are PASS.

Sprint 1 completion status:
- COMPLETE (all checklist items PASS)

## Release readiness check (2026-04-04)

Result:
- NO-GO for production cutover until alarm routing is configured.

Verification summary:
- Local quality gates passed: `validate:schemas`, `build`, `test:adapters`, `test:workflow`, `verify:runtime` (offline).
- Terraform drift check passed: `terraform plan -var='bedrock_strict_contracts=true'` returned clean (no changes).
- Live strict canary passed: `npm run smoke:stepfunctions:strict5` => 5/5 succeeded (duration min/avg/max: 82/94/112s).
- Operational drill passed earlier in session: strict rollback and re-enable both applied successfully with smoke PASS.

Blocking finding:
- CloudWatch alarms are enabled but `AlarmActions` is empty for the Step Functions failure alarm and all per-stage Lambda error alarms.
- Impact: failures will not notify on-call channels, so incident response is not production-safe.

Required remediation before GO:
1. Set `alarm_actions` to at least one SNS topic ARN wired to monitored destinations.
2. Apply Terraform and re-check alarm action wiring.

Example apply:

`terraform -chdir=infra/terraform apply -auto-approve -var='bedrock_strict_contracts=true' -var='alarm_actions=["arn:aws:sns:us-east-1:123456789012:writer-alerts"]'`

GO criteria after remediation:
- Step Functions alarm has non-empty `AlarmActions`.
- All Lambda stage error alarms have non-empty `AlarmActions`.
- A post-apply smoke run succeeds.

Pipeline readiness note:
- Deploy workflow available at `.github/workflows/deploy-test-env.yml` to provision/update test environments via OIDC + Terraform remote state, with strict-mode input and alarm routing enforcement.
