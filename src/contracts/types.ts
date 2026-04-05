export type AgentRole =
  | "NARRATIVE_FOUNDRY"
  | "GHOSTWRITER"
  | "COMPRESSION"
  | "CONTINUITY"
  | "STYLE"
  | "EVALUATOR";

export type QualityDecision = "PASS" | "REWRITE";

export interface CategoryScores {
  coherence: number;
  character_depth: number;
  voice_originality: number;
  scene_craft: number;
  worldbuilding_integration: number;
  prose_precision: number;
  dialogue_subtext: number;
  market_fit: number;
}

export interface EvaluatorReport {
  overall_score: number;
  decision: QualityDecision;
  category_scores: CategoryScores;
  hard_gate_checks: {
    min_overall_met: boolean;
    no_category_below_70: boolean;
    coherence_min_80: boolean;
    scene_craft_min_80: boolean;
  };
  rewrite_directives: Array<{
    priority: number;
    directive: string;
    target_span: string;
    expected_score_lift: number;
  }>;
  confidence: number;
}

export interface WorkflowState {
  runId: string;
  chapterId: string;
  sceneId: string;
  draft: string;
  revisionCount: number;
  maxRevisions: number;
}