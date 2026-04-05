exports.handler = async (event) => {
  const envelope = {
    runId: event?.runId || "unknown-run",
    chapterId: event?.chapterId || "unknown-chapter",
    sceneId: event?.sceneId || "unknown-scene",
    revision: Number.isFinite(event?.revision) ? event.revision : 0,
    maxRevisions: Number.isFinite(event?.maxRevisions) ? event.maxRevisions : 2,
    role: event?.role,
    draft: event?.draft,
    foundry_plan: event?.foundry_plan,
    evaluator_report: event?.evaluator_report,
    rewrite_directives: event?.rewrite_directives,
    stage_output: event?.stage_output
  };

  const role = process.env.STAGE_ROLE || "UNKNOWN";
  let output;

  if (role === "NARRATIVE_FOUNDRY") {
    output = {
      premise: "Placeholder foundry output",
      thematic_thesis: "Placeholder thesis used by Terraform runtime skeleton",
      story_architecture: {
        mode: "three-act",
        acts: [
          { act: 1, purpose: "setup", beats: ["inciting incident"] },
          { act: 2, purpose: "escalation", beats: ["pressure"] },
          { act: 3, purpose: "resolution", beats: ["choice"] }
        ]
      },
      scene_cards: [
        {
          scene_id: envelope.sceneId,
          goal: "Placeholder goal",
          conflict: "Placeholder conflict",
          turn: "Placeholder turn",
          outcome: "Placeholder outcome",
          word_target: 900
        }
      ],
      reveal_schedule: [],
      risk_register: []
    };
    envelope.foundry_plan = output;
  } else if (role === "EVALUATOR") {
    const decision = envelope.revision >= envelope.maxRevisions ? "PASS" : "REWRITE";
    output = {
      overall_score: decision === "PASS" ? 90 : 84,
      decision,
      category_scores: {
        coherence: 85,
        character_depth: 85,
        voice_originality: 85,
        scene_craft: 85,
        worldbuilding_integration: 85,
        prose_precision: 85,
        dialogue_subtext: 85,
        market_fit: 85
      },
      hard_gate_checks: {
        min_overall_met: decision === "PASS",
        no_category_below_70: true,
        coherence_min_80: true,
        scene_craft_min_80: true
      },
      rewrite_directives: decision === "PASS" ? [] : [
        {
          priority: 1,
          directive: "Increase turn severity",
          target_span: "scene ending",
          expected_score_lift: 4
        }
      ],
      confidence: 0.8
    };
    envelope.evaluator_report = output;
    envelope.rewrite_directives = output.rewrite_directives;
    if (decision === "REWRITE") {
      envelope.revision += 1;
    }
  } else {
    output = {
      scene_id: envelope.sceneId,
      prose: `${envelope.draft || ""}\n[${role.toLowerCase()} skeleton pass]`
    };
    envelope.draft = output.prose;
  }

  envelope.role = role;
  envelope.stage_output = output;

  return {
    ok: true,
    role,
    runId: envelope.runId,
    revision: envelope.revision,
    output,
    envelope
  };
};
