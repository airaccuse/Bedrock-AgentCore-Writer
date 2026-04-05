import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { __testOnly } from "../src/orchestrator/agentRouter.js";

type Role = "NARRATIVE_FOUNDRY" | "EVALUATOR";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);

const validators: Record<Role, ReturnType<Ajv2020["compile"]>> = {
  NARRATIVE_FOUNDRY: ajv.compile(
    JSON.parse(
      fs.readFileSync(path.join(projectRoot, "schemas/narrative-foundry-output.schema.json"), "utf8")
    )
  ),
  EVALUATOR: ajv.compile(
    JSON.parse(fs.readFileSync(path.join(projectRoot, "schemas/evaluator-report.schema.json"), "utf8"))
  )
};

function testSafeParseModelJson(): void {
  const fenced = "```json\n{\"ok\":true}\n```";
  const parsedFenced = __testOnly.safeParseModelJson(fenced) as { ok?: boolean };
  assert.equal(parsedFenced.ok, true);

  const withNoise = "Result follows:\n{\"score\":\"82/100\",\"decision\":\"PASS\"}\nThanks";
  const parsedNoise = __testOnly.safeParseModelJson(withNoise) as { score?: string };
  assert.equal(parsedNoise.score, "82/100");
}

function testAdaptLegacyEvaluatorPayloadCamelCase(): void {
  const input = {
    decision: "REWRITE",
    confidence: "0.83",
    categoryScores: {
      coherence: "88",
      characterDepth: "86",
      voiceOriginality: "84",
      sceneCraft: "87",
      worldbuildingIntegration: "90",
      prosePrecision: "85",
      dialogueSubtext: "83",
      marketFit: "82"
    },
    rewriteDirectives: [
      {
        directive: "Sharpen scene turn.",
        targetSpan: "last third",
        expectedScoreLift: "3"
      }
    ]
  };

  const adapted = __testOnly.adaptLegacyEvaluatorPayload(input) as {
    overall_score: number;
    category_scores: Record<string, number>;
    rewrite_directives: Array<{ target_span: string; expected_score_lift: number }>;
    confidence: number;
  };

  assert.equal(adapted.overall_score, 86);
  assert.equal(adapted.category_scores.scene_craft, 87);
  assert.equal(adapted.category_scores.worldbuilding_integration, 90);
  assert.equal(adapted.rewrite_directives[0]?.target_span, "last third");
  assert.equal(adapted.rewrite_directives[0]?.expected_score_lift, 3);
  assert.equal(adapted.confidence, 0.83);
}

function testAdaptLegacyEvaluatorPayloadOverallFallback(): void {
  const input = {
    determination: "PASS",
    confidence: 0.9,
    overallScore: "92%",
    category_scores: {
      coherence: 92,
      character_depth: 90,
      voice_originality: 91,
      scene_craft: 92,
      worldbuilding_integration: 93,
      prose_precision: 90,
      dialogue_subtext: 89,
      market_fit: 90
    }
  };

  const adapted = __testOnly.adaptLegacyEvaluatorPayload(input) as {
    overall_score: number;
    decision: string;
  };

  assert.equal(adapted.overall_score, 92);
  assert.equal(adapted.decision, "PASS");
}

function testStrictModeRejectsLegacyEvaluatorShape(): void {
  const legacyPayload = {
    determination: "REWRITE",
    confidence: 0.81,
    categoryScores: {
      coherence: 84,
      characterDepth: 83,
      voiceOriginality: 82,
      sceneCraft: 80,
      worldbuildingIntegration: 85,
      prosePrecision: 84,
      dialogueSubtext: 82,
      marketFit: 81
    },
    rewriteDirectives: [
      {
        directive: "Clarify the final turn.",
        targetSpan: "closing beats",
        expectedScoreLift: 3
      }
    ]
  };

  assert.equal(validators.EVALUATOR(legacyPayload), false);

  const adapted = __testOnly.adaptLegacyPayload("EVALUATOR", legacyPayload, {});
  assert.equal(validators.EVALUATOR(adapted), true);
}

function testStrictModeRejectsLegacyFoundryShape(): void {
  const legacyPayload = {
    runId: "local-demo-run",
    chapterId: "ch-001",
    sceneId: "sc-001",
    schema: "NarrativeFoundryOutput",
    storyArchitecture: {
      logline: "A captain reactivates a ring that remembers tribunal violence tied to her family.",
      thematicCore: "Memory kept as infrastructure becomes a weapon.",
      actStructure: [
        { title: "Ignition", scenes: [{ sceneId: "sc-001", title: "Signal", keyEvents: ["anomaly"] }] },
        { title: "Escalation", scenes: [{ sceneId: "sc-002", title: "Fracture", keyEvents: ["mutiny"] }] },
        { title: "Consequence", scenes: [{ sceneId: "sc-003", title: "Cost", keyEvents: ["sacrifice"] }] }
      ]
    }
  };

  assert.equal(validators.NARRATIVE_FOUNDRY(legacyPayload), false);

  const adapted = __testOnly.adaptLegacyPayload("NARRATIVE_FOUNDRY", legacyPayload, {
    seedDraft: "Captain Ilya confronts a jurisdictional defense intelligence nested in an orbital ring."
  });
  assert.equal(validators.NARRATIVE_FOUNDRY(adapted), true);
}

function main(): void {
  testSafeParseModelJson();
  testAdaptLegacyEvaluatorPayloadCamelCase();
  testAdaptLegacyEvaluatorPayloadOverallFallback();
  testStrictModeRejectsLegacyEvaluatorShape();
  testStrictModeRejectsLegacyFoundryShape();
  console.log("Adapter regression checks passed");
}

main();
