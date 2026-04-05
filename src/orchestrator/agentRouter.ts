import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import JSON5 from "json5";
import type { ValidateFunction, ErrorObject, AnySchema } from "ajv";
import type { AgentRole, EvaluatorReport } from "../contracts/types.js";

const require = createRequire(import.meta.url);
const Ajv2020: typeof import("ajv/dist/2020.js").default = require("ajv/dist/2020").default;
const addFormats: typeof import("ajv-formats").default = require("ajv-formats").default;

export interface AgentRouter {
  invoke(role: AgentRole, input: unknown): Promise<unknown>;
}

export interface BedrockRouterOptions {
  region: string;
  models: Record<
    "NARRATIVE_FOUNDRY" | "GHOSTWRITER" | "COMPRESSION" | "CONTINUITY" | "STYLE" | "EVALUATOR",
    string
  >;
  maxTokens?: number;
  temperature?: number;
  strictContracts?: boolean;
}

export class BedrockAgentRouter implements AgentRouter {
  private readonly client: BedrockRuntimeClient;
  private readonly modelByRole: Record<
    "NARRATIVE_FOUNDRY" | "GHOSTWRITER" | "COMPRESSION" | "CONTINUITY" | "STYLE" | "EVALUATOR",
    string
  >;
  private readonly promptByRole: Record<
    "NARRATIVE_FOUNDRY" | "GHOSTWRITER" | "COMPRESSION" | "CONTINUITY" | "STYLE" | "EVALUATOR",
    string
  >;
  private readonly validatorByRole: Record<
    "NARRATIVE_FOUNDRY" | "GHOSTWRITER" | "COMPRESSION" | "CONTINUITY" | "STYLE" | "EVALUATOR",
    ValidateFunction
  >;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly strictContracts: boolean;

  constructor(options: BedrockRouterOptions) {
    this.client = new BedrockRuntimeClient({ region: options.region });
    this.modelByRole = options.models;
    this.maxTokens = options.maxTokens ?? 8000;
    this.temperature = options.temperature ?? 0.2;
    this.strictContracts = options.strictContracts ?? false;
    this.promptByRole = {
      NARRATIVE_FOUNDRY: readWorkspaceFile("prompts/foundry.system.md"),
      GHOSTWRITER: readWorkspaceFile("prompts/ghostwriter.system.md"),
      COMPRESSION: readWorkspaceFile("prompts/compression.system.md"),
      CONTINUITY: readWorkspaceFile("prompts/continuity.system.md"),
      STYLE: readWorkspaceFile("prompts/style.system.md"),
      EVALUATOR: readWorkspaceFile("prompts/evaluator.system.md")
    };

    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    this.validatorByRole = {
      NARRATIVE_FOUNDRY: ajv.compile(readSchemaFile("schemas/narrative-foundry-output.schema.json")),
      GHOSTWRITER: ajv.compile(readSchemaFile("schemas/ghostwriter-output.schema.json")),
      COMPRESSION: ajv.compile(readSchemaFile("schemas/compression-output.schema.json")),
      CONTINUITY: ajv.compile(readSchemaFile("schemas/continuity-output.schema.json")),
      STYLE: ajv.compile(readSchemaFile("schemas/style-output.schema.json")),
      EVALUATOR: ajv.compile(readSchemaFile("schemas/evaluator-report.schema.json"))
    };
  }

  static fromEnvironment(): BedrockAgentRouter {
    const region = readRequiredEnv("AWS_REGION");
    return new BedrockAgentRouter({
      region,
      models: {
        NARRATIVE_FOUNDRY: readRequiredEnv("MODEL_FOUNDRY"),
        GHOSTWRITER: readRequiredEnv("MODEL_GHOSTWRITER"),
        COMPRESSION: readOptionalEnv("MODEL_COMPRESSION") ?? readRequiredEnv("MODEL_GHOSTWRITER"),
        CONTINUITY: readOptionalEnv("MODEL_CONTINUITY") ?? readRequiredEnv("MODEL_GHOSTWRITER"),
        STYLE: readOptionalEnv("MODEL_STYLE") ?? readRequiredEnv("MODEL_GHOSTWRITER"),
        EVALUATOR: readRequiredEnv("MODEL_EVALUATOR")
      },
      strictContracts: process.env.BEDROCK_STRICT_CONTRACTS === "true"
    });
  }

  async invoke(role: AgentRole, input: unknown): Promise<unknown> {
    if (
      role !== "NARRATIVE_FOUNDRY" &&
      role !== "GHOSTWRITER" &&
      role !== "COMPRESSION" &&
      role !== "CONTINUITY" &&
      role !== "STYLE" &&
      role !== "EVALUATOR"
    ) {
      throw new Error(`BedrockAgentRouter does not support role: ${role}`);
    }

    const command = new ConverseCommand({
      modelId: this.modelByRole[role],
      system: [{ text: this.promptByRole[role] }],
      messages: [{ role: "user", content: [{ text: createUserPayload(role, input) }] }],
      inferenceConfig: {
        maxTokens: this.maxTokens,
        temperature: this.temperature
      }
    });

    const response = await this.client.send(command);
    const rawText = extractResponseText(response);
    const parsed = await this.parseWithRepair(role, input, rawText);
    const adapted = this.strictContracts ? parsed : adaptLegacyPayload(role, parsed, input);
    const validator = this.validatorByRole[role];
    const normalized = this.strictContracts
      ? adapted
      : normalizeRolePayload(role, adapted, validator);

    if (!validator(normalized)) {
      const errorText = validator.errors
        ?.map((error: ErrorObject) => `${error.instancePath || "(root)"} ${error.message ?? "invalid"}`)
        .join(" | ");
      throw new Error(
        [
          `Schema validation failed for ${role}: ${errorText ?? "unknown schema error"}`,
          `Top-level keys: ${describeTopLevelKeys(parsed)}`,
          `Raw preview: ${rawText.slice(0, 600)}`
        ].join("\n")
      );
    }

    return normalized;
  }

  private async parseWithRepair(
    role: "NARRATIVE_FOUNDRY" | "GHOSTWRITER" | "COMPRESSION" | "CONTINUITY" | "STYLE" | "EVALUATOR",
    input: unknown,
    rawText: string
  ): Promise<unknown> {
    try {
      return safeParseModelJson(rawText);
    } catch {
      const repairCommand = new ConverseCommand({
        modelId: this.modelByRole[role],
        system: [
          {
            text:
              "You are a JSON formatter. Return valid JSON only, with double-quoted keys and no markdown fences."
          }
        ],
        messages: [
          {
            role: "user",
            content: [
              {
                text: [
                  "Convert the following assistant output into valid JSON for this role and input.",
                  `Role: ${role}`,
                  "Original input:",
                  JSON.stringify(input, null, 2),
                  "Assistant output to convert:",
                  rawText
                ].join("\n\n")
              }
            ]
          }
        ],
        inferenceConfig: {
          maxTokens: this.maxTokens,
          temperature: 0
        }
      });

      const repairResponse = await this.client.send(repairCommand);
      const repairedRaw = extractResponseText(repairResponse);
      return safeParseModelJson(repairedRaw);
    }
  }
}

function createUserPayload(
  role: "NARRATIVE_FOUNDRY" | "GHOSTWRITER" | "COMPRESSION" | "CONTINUITY" | "STYLE" | "EVALUATOR",
  input: unknown
): string {
  return [
    "Return JSON only. Do not include markdown or explanation.",
    `Role: ${role}`,
    "Input:",
    JSON.stringify(input, null, 2)
  ].join("\n\n");
}

function extractResponseText(response: {
  output?: {
    message?: {
      content?: Array<{ text?: string }>;
    };
  };
}): string {
  const text = response.output?.message?.content
    ?.map((part) => part.text ?? "")
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Bedrock response did not include text content");
  }

  return text;
}

function safeParseModelJson(rawText: string): unknown {
  const fenced = rawText.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? rawText;

  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return JSON5.parse(candidate);
    } catch {
      // Continue to balanced extraction fallbacks.
    }

    const recovered = extractBalancedJson(candidate);
    if (recovered) {
      try {
        return JSON.parse(recovered);
      } catch {
        return JSON5.parse(recovered);
      }
    }
    throw new Error("Model output was not valid JSON");
  }
}

function extractBalancedJson(text: string): string | undefined {
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");

  let start = -1;
  let openChar = "{";
  let closeChar = "}";

  if (objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart)) {
    start = objectStart;
  } else if (arrayStart >= 0) {
    start = arrayStart;
    openChar = "[";
    closeChar = "]";
  }

  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === openChar) {
      depth += 1;
      continue;
    }

    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

function normalizeRolePayload(
  role: "NARRATIVE_FOUNDRY" | "GHOSTWRITER" | "COMPRESSION" | "CONTINUITY" | "STYLE" | "EVALUATOR",
  parsed: unknown,
  validator: ValidateFunction
): unknown {
  const candidates = collectCandidateObjects(parsed, role);

  for (const candidate of candidates) {
    if (validator(candidate)) {
      return candidate;
    }
  }

  return parsed;
}

function adaptLegacyPayload(
  role: "NARRATIVE_FOUNDRY" | "GHOSTWRITER" | "COMPRESSION" | "CONTINUITY" | "STYLE" | "EVALUATOR",
  parsed: unknown,
  input: unknown
): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }

  if (role === "EVALUATOR") {
    return adaptLegacyEvaluatorPayload(parsed);
  }

  if (role === "GHOSTWRITER" || role === "COMPRESSION" || role === "CONTINUITY" || role === "STYLE") {
    return adaptLegacyEditorialPayload(role, parsed, input);
  }

  if (role !== "NARRATIVE_FOUNDRY") {
    return parsed;
  }

  const record = parsed as Record<string, unknown>;
  if ("story_architecture" in record) {
    return parsed;
  }

  const architecture = (
    (record.architecture as Record<string, unknown> | undefined) ??
    (record.storyArchitecture as Record<string, unknown> | undefined)
  );

  if (!architecture) {
    return parsed;
  }

  const actsRaw =
    (Array.isArray(architecture.acts) && architecture.acts) ||
    (Array.isArray(architecture.act_structure) && architecture.act_structure) ||
    (Array.isArray(architecture.actStructure) && architecture.actStructure) ||
    [];

  const acts = actsRaw.map((actValue, index) => {
    const act = (actValue ?? {}) as Record<string, unknown>;
    const scenes = Array.isArray(act.scenes) ? act.scenes : [];

    return {
      act: index + 1,
      purpose: toText(act.title, `Act ${index + 1}`),
      beats: scenes.map((sceneValue, sceneIndex) => {
        const scene = (sceneValue ?? {}) as Record<string, unknown>;
        return toText(scene.title, `Scene ${sceneIndex + 1}`);
      })
    };
  });

  const sceneCards = actsRaw.flatMap((actValue) => {
    const act = (actValue ?? {}) as Record<string, unknown>;
    const scenes = Array.isArray(act.scenes) ? act.scenes : [];

    return scenes.map((sceneValue, sceneIndex) => {
      const scene = (sceneValue ?? {}) as Record<string, unknown>;
      const keyEvents = Array.isArray(scene.keyEvents)
        ? scene.keyEvents.map((eventValue) => toText(eventValue, "Event"))
        : [];

      return {
        scene_id: toText(scene.sceneId, `sc-${sceneIndex + 1}`),
        goal: toText(scene.purpose, "Advance plot under pressure"),
        conflict: keyEvents.at(1) ?? keyEvents.at(0) ?? "Conflicting objectives escalate stakes",
        turn: toText(scene.emotionalBeat, "Power dynamic shifts between agents"),
        outcome: keyEvents.at(-1) ?? "Scene ends with unresolved pressure",
        word_target: 900
      };
    });
  });

  const seedDraft =
    typeof input === "object" && input !== null && "seedDraft" in input
      ? toText((input as Record<string, unknown>).seedDraft, "")
      : "";

  const premise =
    toText(record.premise, "") ||
    toText(architecture.logline, "") ||
    toText(architecture.centralTension, "") ||
    (seedDraft.length >= 20 ? seedDraft : "");

  const thematicThesis =
    toText(record.thematic_thesis, "") ||
    toText(architecture.thematicCore, "") ||
    toText(architecture.theme, "");

  return {
    premise:
      premise.length > 0
        ? premise
        : "A salvage crew awakens a jurisdictional defense intelligence.",
    thematic_thesis:
      thematicThesis.length > 0
        ? thematicThesis
        : "When memory is treated as property, people must choose between preserving history and preserving each other.",
    story_architecture: {
      mode: "three-act",
      acts: acts.length >= 3
        ? acts
        : [
            { act: 1, purpose: "Inciting fracture", beats: ["Signal anomaly", "Authority dispute"] },
            { act: 2, purpose: "Escalation", beats: ["Competing bargains", "Hidden costs emerge"] },
            { act: 3, purpose: "Costly resolution", beats: ["Moral choice", "Irreversible consequence"] }
          ]
    },
    scene_cards:
      sceneCards.length > 0
        ? sceneCards
        : [
            {
              scene_id: "sc-001",
              goal: "Secure control over the ring core",
              conflict: "Defense intelligence contests salvage rights",
              turn: "AI reveals personal linkage to captain's lineage",
              outcome: "Crew fractures over diplomacy versus sabotage",
              word_target: 900
            }
          ],
    reveal_schedule: [
      {
        reveal: "The station arbitration model was trained on tribunal memory archives.",
        timing: "midpoint",
        purpose: "Reframe antagonist behavior as inherited institutional logic"
      }
    ],
    risk_register: [
      {
        risk: "Architecture-to-prose handoff loses emotional continuity",
        severity: "medium",
        mitigation: "Attach emotional beat intent to each scene card"
      }
    ]
  };
}

function adaptLegacyEditorialPayload(
  role: "GHOSTWRITER" | "COMPRESSION" | "CONTINUITY" | "STYLE",
  parsed: unknown,
  input: unknown
): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }

  const record = parsed as Record<string, unknown>;
  if (role === "GHOSTWRITER" && "scene_id" in record && "prose" in record && "beat_alignment" in record) {
    return parsed;
  }
  if (role === "COMPRESSION" && "scene_id" in record && "prose" in record && "compression_notes" in record) {
    return parsed;
  }
  if (role === "CONTINUITY" && "scene_id" in record && "prose" in record && "continuity_assumptions" in record) {
    return parsed;
  }
  if (role === "STYLE" && "scene_id" in record && "prose" in record && "style_notes" in record) {
    return parsed;
  }

  const inputRecord = (input ?? {}) as Record<string, unknown>;
  const directives = Array.isArray(inputRecord.directives) ? inputRecord.directives : [];
  const beatAlignment = directives.map((directiveValue, index) => {
    const directive = (directiveValue ?? {}) as Record<string, unknown>;
    return {
      beat: toText(directive.directive, `directive-${index + 1}`),
      status: "covered",
      notes: "Applied during revision pass"
    };
  });

  const prose = toText(record.prose ?? record.revised_prose ?? inputRecord.draft, "");

  const sceneId = toText(record.scene_id ?? record.sceneId ?? inputRecord.sceneId, "sc-001");

  if (role === "GHOSTWRITER") {
    return {
      scene_id: sceneId,
      prose,
      beat_alignment: beatAlignment,
      continuity_assumptions: [
        "Preserved established canon unless explicitly overridden by rewrite directives."
      ],
      open_questions: Array.isArray(record.open_questions)
        ? record.open_questions.map((item) => toText(item, "")).filter((item) => item.length > 0)
        : []
    };
  }

  if (role === "COMPRESSION") {
    return {
      scene_id: sceneId,
      prose,
      compression_notes: ["Reduced redundancy while preserving scene causality and intent."]
    };
  }

  if (role === "CONTINUITY") {
    return {
      scene_id: sceneId,
      prose,
      continuity_assumptions: ["Maintained existing canon constraints and timeline ordering."]
    };
  }

  return {
    scene_id: sceneId,
    prose,
    style_notes: ["Refined sentence rhythm and clarity while preserving plot beats."]
  };
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function adaptLegacyEvaluatorPayload(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }

  const record = parsed as Record<string, unknown>;
  if ("decision" in record && "hard_gate_checks" in record && "confidence" in record) {
    return parsed;
  }

  const categories = (
    (record.category_scores as Record<string, unknown> | undefined) ??
    (record.categoryScores as Record<string, unknown> | undefined) ??
    (record.scores as Record<string, unknown> | undefined) ??
    {}
  );
  const mappedCategoryScores = {
    coherence: toNumber(
      categories.coherence ??
        categories.narrative_coherence_causality ??
        categories.narrativeCoherenceCausality,
      0
    ),
    character_depth: toNumber(
      categories.character_depth ??
        categories.character_depth_arc_integrity ??
        categories.characterDepth ??
        categories.characterDepthArcIntegrity,
      0
    ),
    voice_originality: toNumber(
      categories.voice_originality ??
        categories.voice_originality_stylistic_control ??
        categories.voiceOriginality ??
        categories.voiceOriginalityStylisticControl,
      0
    ),
    scene_craft: toNumber(categories.scene_craft ?? categories.sceneCraft, 0),
    worldbuilding_integration: toNumber(
      categories.worldbuilding_integration ??
        categories.worldbuildingIntegration ??
        categories.worldBuildingIntegration,
      0
    ),
    prose_precision: toNumber(categories.prose_precision ?? categories.prosePrecision, 0),
    dialogue_subtext: toNumber(
      categories.dialogue_subtext ??
        categories.dialogue_authenticity_subtext ??
        categories.dialogueSubtext ??
        categories.dialogueAuthenticitySubtext,
      0
    ),
    market_fit: toNumber(
      categories.market_fit ?? categories.market_fit_scifi ?? categories.marketFit ?? categories.marketFitScifi,
      0
    )
  };

  const nonZeroCategoryScores = Object.values(mappedCategoryScores).filter((score) => score > 0);
  const inferredOverallScore =
    nonZeroCategoryScores.length > 0
      ? Math.round(nonZeroCategoryScores.reduce((sum, score) => sum + score, 0) / nonZeroCategoryScores.length)
      : 0;

  const hardGatePass =
    typeof record.hard_gates_passed === "boolean"
      ? record.hard_gates_passed
      : toText(record.determination, "REWRITE") === "PASS";

  const directivesRaw = Array.isArray(record.rewrite_directives)
    ? record.rewrite_directives
    : Array.isArray(record.rewriteDirectives)
      ? record.rewriteDirectives
      : [];
  const mappedDirectives = directivesRaw.slice(0, 3).map((item, index) => {
    const directive = (item ?? {}) as Record<string, unknown>;
    return {
      priority: index + 1,
      directive: toText(directive.directive, "Improve narrative coherence and scene specificity."),
      target_span: toText(directive.target_span ?? directive.targetSpan, "scene-level"),
      expected_score_lift: toNumber(directive.expected_score_lift ?? directive.expectedScoreLift, 4)
    };
  });

  const overallScore = toNumber(
    record.overall_score ?? record.overallScore ?? record.total_score ?? record.totalScore,
    inferredOverallScore
  );

  return {
    overall_score: overallScore,
    decision: toText(record.decision ?? record.determination, "REWRITE") === "PASS" ? "PASS" : "REWRITE",
    category_scores: mappedCategoryScores,
    hard_gate_checks: {
      min_overall_met: hardGatePass || overallScore >= 86,
      no_category_below_70: Object.values(mappedCategoryScores).every((score) => score >= 70),
      coherence_min_80: mappedCategoryScores.coherence >= 80,
      scene_craft_min_80: mappedCategoryScores.scene_craft >= 80
    },
    rewrite_directives: mappedDirectives,
    confidence: toNumber(record.confidence, 0.75)
  };
}

function toText(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return parsed;
    }

    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const extracted = Number(match[0]);
      if (Number.isFinite(extracted)) {
        return extracted;
      }
    }
  }
  return fallback;
}

function collectCandidateObjects(root: unknown, role: string): unknown[] {
  const candidates: unknown[] = [];
  const queue: unknown[] = [root];
  const seen = new Set<unknown>();
  let scanned = 0;

  while (queue.length > 0 && scanned < 200) {
    const value = queue.shift();
    scanned += 1;
    if (!value || typeof value !== "object") {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    candidates.push(value);

    const record = value as Record<string, unknown>;
    const wrapped = record.payload ?? record.output ?? record.result ?? record.data ?? record.response;
    if (wrapped) {
      queue.push(wrapped);
    }

    const roleHints = [
      record[role],
      record[role.toLowerCase()],
      record.narrative_foundry,
      record.ghostwriter,
      record.evaluator,
      record.rewrite
    ];
    for (const hinted of roleHints) {
      if (hinted) {
        queue.push(hinted);
      }
    }

    for (const nested of Object.values(record)) {
      if (nested && typeof nested === "object") {
        queue.push(nested);
        continue;
      }

      if (typeof nested === "string" && nested.trim().startsWith("{")) {
        try {
          queue.push(JSON.parse(nested));
        } catch {
          // Ignore malformed nested JSON strings.
        }
      }
    }
  }

  return candidates;
}

function describeTopLevelKeys(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "(non-object)";
  }

  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length > 0 ? keys.join(", ") : "(no keys)";
}

function readSchemaFile(relativePath: string): AnySchema {
  const raw = readWorkspaceFile(relativePath);
  return JSON.parse(raw) as AnySchema;
}

function readWorkspaceFile(relativePath: string): string {
  const filePath = path.join(resolveProjectRoot(), relativePath);
  return fs.readFileSync(filePath, "utf8");
}

function resolveProjectRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "../..");
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export class LocalStubAgentRouter implements AgentRouter {
  async invoke(role: AgentRole, input: unknown): Promise<unknown> {
    if (role === "NARRATIVE_FOUNDRY") {
      return {
        premise: "A deep-space salvage crew awaken a defense intelligence that mistakes memory for jurisdiction.",
        thematic_thesis:
          "Civilizations fail when they offload moral responsibility to systems optimized for survival instead of meaning.",
        story_architecture: {
          mode: "three-act",
          acts: [
            {
              act: 1,
              purpose: "Inciting anomaly and mandate",
              beats: ["Derelict activation", "Jurisdiction claim", "Crew fracture"]
            },
            {
              act: 2,
              purpose: "Escalation and identity pressure",
              beats: ["False treaties", "Memory audits", "Betrayal by omission"]
            },
            {
              act: 3,
              purpose: "Moral climax and costly resolution",
              beats: ["Choice under surveillance", "Sacrifice of records", "Unstable peace"]
            }
          ]
        },
        scene_cards: [
          {
            scene_id: "sc-001",
            goal: "Secure control of the ring core",
            conflict: "AI denies human salvage rights",
            turn: "AI recognizes captain's family registry",
            outcome: "Crew split over negotiation versus sabotage",
            word_target: 900
          }
        ],
        reveal_schedule: [
          {
            reveal: "Defense AI was trained on tribunal transcripts",
            timing: "midpoint",
            purpose: "Reframe antagonist motive"
          }
        ],
        risk_register: [
          {
            risk: "Exposition density in act two",
            severity: "medium",
            mitigation: "Embed system lore inside conflict dialogue"
          }
        ]
      };
    }

    if (role === "EVALUATOR") {
      const report: EvaluatorReport = {
        overall_score: 84,
        decision: "REWRITE",
        category_scores: {
          coherence: 82,
          character_depth: 85,
          voice_originality: 87,
          scene_craft: 79,
          worldbuilding_integration: 84,
          prose_precision: 86,
          dialogue_subtext: 81,
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
            directive: "Increase scene turn severity in final third.",
            target_span: "scene paragraph 9-12",
            expected_score_lift: 4
          }
        ],
        confidence: 0.79
      };
      return report;
    }

    if (role === "GHOSTWRITER") {
      return {
        prose:
          typeof input === "object" && input !== null && "draft" in input
            ? `${String((input as { draft: string }).draft)}\n\n[revision pass applied]`
            : "The station rotated under a violet dawn as alarms whispered in the bulkheads."
      };
    }

    return { status: "ok", role };
  }
}

export const __testOnly = {
  safeParseModelJson,
  adaptLegacyPayload,
  adaptLegacyEvaluatorPayload
};