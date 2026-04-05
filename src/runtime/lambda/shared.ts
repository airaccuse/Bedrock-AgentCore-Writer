import type { AgentRole } from "../../contracts/types.js";
import type { AgentRouter } from "../../orchestrator/agentRouter.js";
import { BedrockAgentRouter, LocalStubAgentRouter } from "../../orchestrator/agentRouter.js";
import type { ArtifactStore } from "../../orchestrator/artifactStore.js";
import { createArtifactStoreFromEnvironment } from "../../orchestrator/artifactStore.js";
import type { StageFailure, StageResult, StageSuccess, WorkflowEnvelope } from "../stepFunctions/types.js";

export function createRuntimeDeps(): { router: AgentRouter; artifactStore: ArtifactStore } {
  const useStub = process.env.USE_LOCAL_STUB_ROUTER === "true";
  return {
    router: useStub ? new LocalStubAgentRouter() : BedrockAgentRouter.fromEnvironment(),
    artifactStore: createArtifactStoreFromEnvironment()
  };
}

export async function executeStage(
  role: AgentRole,
  artifactKind: string,
  envelope: WorkflowEnvelope,
  payload: unknown,
  applyOutput: (envelope: WorkflowEnvelope, output: unknown) => WorkflowEnvelope
): Promise<StageResult> {
  try {
    const { router, artifactStore } = createRuntimeDeps();
    const output = await router.invoke(role, payload);
    const artifactUri = await artifactStore.save(envelope.runId, artifactKind, envelope.revision, output);

    const nextEnvelope = applyOutput(envelope, output);

    const success: StageSuccess = {
      ok: true,
      role,
      runId: envelope.runId,
      revision: envelope.revision,
      artifactKind,
      artifactUri,
      output,
      envelope: nextEnvelope
    };

    return success;
  } catch (error) {
    return toStageFailure(role, envelope, error);
  }
}

export function toStageFailure(role: AgentRole, envelope: WorkflowEnvelope, error: unknown): StageFailure {
  const message = error instanceof Error ? error.message : "Unknown stage error";
  const dependency = /Missing required environment variable|Credentials|AccessDenied|ResourceNotFound/i.test(message);
  const validation = /Schema validation failed/i.test(message);

  return {
    ok: false,
    role,
    runId: envelope.runId,
    revision: envelope.revision,
    envelope,
    errorType: validation ? "ValidationError" : dependency ? "DependencyError" : "InvocationError",
    message,
    details: error,
    retryable: dependency || /timeout|throttl/i.test(message)
  };
}

export function requireEnvelope(input: unknown): WorkflowEnvelope {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid workflow envelope: expected object");
  }

  const record = input as Record<string, unknown>;
  const runId = typeof record.runId === "string" ? record.runId : "";
  const chapterId = typeof record.chapterId === "string" ? record.chapterId : "";
  const sceneId = typeof record.sceneId === "string" ? record.sceneId : "";
  const revision = typeof record.revision === "number" ? record.revision : 0;
  const maxRevisions = typeof record.maxRevisions === "number" ? record.maxRevisions : 2;

  if (!runId || !chapterId || !sceneId) {
    throw new Error("Invalid workflow envelope: runId, chapterId, and sceneId are required");
  }

  return {
    runId,
    chapterId,
    sceneId,
    revision,
    maxRevisions,
    role: typeof record.role === "string" ? (record.role as AgentRole) : undefined,
    foundry_plan: record.foundry_plan,
    draft: typeof record.draft === "string" ? record.draft : undefined,
    evaluator_report: record.evaluator_report,
    rewrite_directives: record.rewrite_directives,
    stage_output: record.stage_output
  };
}
