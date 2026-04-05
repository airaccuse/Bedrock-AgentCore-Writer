import type { AgentRole } from "../../contracts/types.js";
import { executeStage, requireEnvelope } from "./shared.js";
import type { StageResult, WorkflowEnvelope } from "../stepFunctions/types.js";

type LambdaHandler = (event: unknown) => Promise<StageResult>;

function buildRolePayload(role: AgentRole, envelope: WorkflowEnvelope): unknown {
  if (role === "NARRATIVE_FOUNDRY") {
    return {
      runId: envelope.runId,
      chapterId: envelope.chapterId,
      sceneId: envelope.sceneId,
      seedDraft: envelope.draft ?? ""
    };
  }

  if (role === "EVALUATOR") {
    return {
      draft: envelope.draft ?? ""
    };
  }

  if (role === "GHOSTWRITER") {
    return {
      runId: envelope.runId,
      chapterId: envelope.chapterId,
      sceneId: envelope.sceneId,
      draft: envelope.draft ?? "",
      foundry_plan: envelope.foundry_plan,
      directives: envelope.rewrite_directives
    };
  }

  if (role === "COMPRESSION") {
    return {
      runId: envelope.runId,
      chapterId: envelope.chapterId,
      sceneId: envelope.sceneId,
      draft: envelope.draft ?? "",
      directives: envelope.rewrite_directives
    };
  }

  if (role === "CONTINUITY") {
    return {
      runId: envelope.runId,
      chapterId: envelope.chapterId,
      sceneId: envelope.sceneId,
      draft: envelope.draft ?? "",
      foundry_plan: envelope.foundry_plan
    };
  }

  return {
    runId: envelope.runId,
    chapterId: envelope.chapterId,
    sceneId: envelope.sceneId,
    draft: envelope.draft ?? ""
  };
}

function applyOutput(role: AgentRole, envelope: WorkflowEnvelope, output: unknown): WorkflowEnvelope {
  const updated: WorkflowEnvelope = {
    ...envelope,
    role,
    stage_output: output
  };

  if (role === "NARRATIVE_FOUNDRY") {
    updated.foundry_plan = output;
    return updated;
  }

  if (role === "EVALUATOR") {
    const evaluator = output as Record<string, unknown>;
    const decision = typeof evaluator.decision === "string" ? evaluator.decision : "REWRITE";

    updated.evaluator_report = output;
    updated.rewrite_directives = Array.isArray(evaluator.rewrite_directives)
      ? evaluator.rewrite_directives
      : [];

    if (decision === "REWRITE" && updated.revision < updated.maxRevisions) {
      updated.revision += 1;
    }

    if (decision === "REWRITE" && updated.revision >= updated.maxRevisions) {
      updated.evaluator_report = {
        ...evaluator,
        decision: "PASS"
      };
    }

    return updated;
  }

  if (role === "GHOSTWRITER" || role === "COMPRESSION" || role === "CONTINUITY" || role === "STYLE") {
    const record = output as Record<string, unknown>;
    if (typeof record.prose === "string") {
      updated.draft = record.prose;
    }
  }

  return updated;
}

function stageHandler(role: AgentRole, artifactKind: string): LambdaHandler {
  return async (event: unknown): Promise<StageResult> => {
    const envelope = requireEnvelope(event);
    const payload = buildRolePayload(role, envelope);

    return executeStage(role, artifactKind, envelope, payload, (current, output) =>
      applyOutput(role, current, output)
    );
  };
}

export const narrativeFoundryHandler = stageHandler("NARRATIVE_FOUNDRY", "foundry-output");
export const ghostwriterHandler = stageHandler("GHOSTWRITER", "ghostwriter-output");
export const compressionHandler = stageHandler("COMPRESSION", "compression-output");
export const continuityHandler = stageHandler("CONTINUITY", "continuity-output");
export const styleHandler = stageHandler("STYLE", "style-output");
export const evaluatorHandler = stageHandler("EVALUATOR", "evaluator-report");
