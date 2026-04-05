import assert from "node:assert/strict";
import type { AgentRole, EvaluatorReport, WorkflowState } from "../src/contracts/types.js";
import type { AgentRouter } from "../src/orchestrator/agentRouter.js";
import type { ArtifactStore } from "../src/orchestrator/artifactStore.js";
import { runRevisionWorkflow } from "../src/orchestrator/workflow.js";

class RecordingRouter implements AgentRouter {
  public readonly calls: AgentRole[] = [];

  async invoke(role: AgentRole, input: unknown): Promise<unknown> {
    this.calls.push(role);

    if (role === "NARRATIVE_FOUNDRY") {
      return {
        premise: "A salvage crew awaken a defense intelligence that mistakes memory for jurisdiction.",
        thematic_thesis:
          "When memory is treated as property, people must choose between preserving history and preserving each other.",
        story_architecture: {
          mode: "three-act",
          acts: [
            { act: 1, purpose: "Incitement", beats: ["Signal", "Claim"] },
            { act: 2, purpose: "Escalation", beats: ["Split", "Breach"] },
            { act: 3, purpose: "Resolution", beats: ["Choice", "Cost"] }
          ]
        },
        scene_cards: [
          {
            scene_id: "sc-001",
            goal: "Secure ring access",
            conflict: "AI contests rights",
            turn: "Captain identity is recognized",
            outcome: "Crew fractures",
            word_target: 900
          }
        ],
        reveal_schedule: [
          { reveal: "AI trained on tribunal archives", timing: "midpoint", purpose: "reframe motive" }
        ],
        risk_register: [{ risk: "handoff drift", severity: "medium", mitigation: "attach beat intent" }]
      };
    }

    if (role === "EVALUATOR") {
      const evaluatorCallIndex = this.calls.filter((item) => item === "EVALUATOR").length;
      const firstPass: EvaluatorReport = {
        overall_score: 84,
        decision: "REWRITE",
        category_scores: {
          coherence: 82,
          character_depth: 84,
          voice_originality: 85,
          scene_craft: 79,
          worldbuilding_integration: 84,
          prose_precision: 85,
          dialogue_subtext: 82,
          market_fit: 83
        },
        hard_gate_checks: {
          min_overall_met: false,
          no_category_below_70: true,
          coherence_min_80: true,
          scene_craft_min_80: false
        },
        rewrite_directives: [
          {
            priority: 1,
            directive: "Increase final turn severity",
            target_span: "closing third",
            expected_score_lift: 4
          }
        ],
        confidence: 0.79
      };

      const secondPass: EvaluatorReport = {
        overall_score: 90,
        decision: "PASS",
        category_scores: {
          coherence: 90,
          character_depth: 90,
          voice_originality: 90,
          scene_craft: 89,
          worldbuilding_integration: 90,
          prose_precision: 90,
          dialogue_subtext: 89,
          market_fit: 90
        },
        hard_gate_checks: {
          min_overall_met: true,
          no_category_below_70: true,
          coherence_min_80: true,
          scene_craft_min_80: true
        },
        rewrite_directives: [],
        confidence: 0.88
      };

      return evaluatorCallIndex === 1 ? firstPass : secondPass;
    }

    if (role === "GHOSTWRITER") {
      const record = input as { draft?: string };
      return { prose: `${record.draft ?? ""}\n[ghostwriter]` };
    }

    if (role === "COMPRESSION") {
      const record = input as { draft?: string };
      return { prose: `${record.draft ?? ""}\n[compression]` };
    }

    if (role === "CONTINUITY") {
      const record = input as { draft?: string };
      return { prose: `${record.draft ?? ""}\n[continuity]` };
    }

    if (role === "STYLE") {
      const record = input as { draft?: string };
      return { prose: `${record.draft ?? ""}\n[style]` };
    }

    throw new Error(`Unexpected role: ${role}`);
  }
}

class RecordingArtifactStore implements ArtifactStore {
  public readonly writes: Array<{ runId: string; kind: string; iteration: number }> = [];

  async save(runId: string, kind: string, iteration: number, _payload: unknown): Promise<string> {
    this.writes.push({ runId, kind, iteration });
    return `memory://${runId}/${iteration}/${kind}`;
  }
}

async function main(): Promise<void> {
  const router = new RecordingRouter();
  const store = new RecordingArtifactStore();

  const state: WorkflowState = {
    runId: "test-run",
    chapterId: "ch-001",
    sceneId: "sc-001",
    draft: "Base draft",
    revisionCount: 0,
    maxRevisions: 2
  };

  const result = await runRevisionWorkflow(router, state, store);

  assert.deepEqual(router.calls, [
    "NARRATIVE_FOUNDRY",
    "EVALUATOR",
    "GHOSTWRITER",
    "COMPRESSION",
    "CONTINUITY",
    "STYLE",
    "EVALUATOR"
  ]);

  assert.deepEqual(
    store.writes.map((item) => `${item.iteration}:${item.kind}`),
    [
      "0:foundry-output",
      "0:evaluator-report",
      "1:rewrite-directives",
      "1:ghostwriter-output",
      "1:compression-output",
      "1:continuity-output",
      "1:style-output",
      "1:evaluator-report"
    ]
  );

  assert.equal(result.revisions, 1);
  assert.equal(result.report.decision, "PASS");
  assert.equal(result.finalDraft.endsWith("[style]"), true);

  console.log("Workflow integration checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
