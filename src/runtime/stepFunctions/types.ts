import type { AgentRole } from "../../contracts/types.js";

export interface WorkflowEnvelope {
  runId: string;
  chapterId: string;
  sceneId: string;
  revision: number;
  maxRevisions: number;
  role?: AgentRole;
  foundry_plan?: unknown;
  draft?: string;
  evaluator_report?: unknown;
  rewrite_directives?: unknown;
  stage_output?: unknown;
}

export interface StageSuccess {
  ok: true;
  role: AgentRole;
  runId: string;
  revision: number;
  artifactKind: string;
  artifactUri: string;
  output: unknown;
  envelope: WorkflowEnvelope;
}

export interface StageFailure {
  ok: false;
  role: AgentRole;
  runId: string;
  revision: number;
  envelope: WorkflowEnvelope;
  errorType: "ValidationError" | "InvocationError" | "DependencyError" | "UnknownError";
  message: string;
  details?: unknown;
  retryable: boolean;
}

export type StageResult = StageSuccess | StageFailure;
