import { config as loadDotenv } from "dotenv";
import { BedrockClient, GetFoundationModelCommand, GetInferenceProfileCommand } from "@aws-sdk/client-bedrock";
import {
  DeleteItemCommand,
  DescribeTableCommand,
  DynamoDBClient,
  PutItemCommand
} from "@aws-sdk/client-dynamodb";

loadDotenv({ override: true });

const region = requireEnv("AWS_REGION");
const artifactMode = process.env.ARTIFACT_STORE_MODE ?? "local";
const verifyMode = process.env.VERIFY_RUNTIME_MODE ?? "live";
const writeProbeEnabled = process.env.VERIFY_RUNTIME_WRITE_TEST === "true";
const supervisorE2EEnabled = process.env.VERIFY_SUPERVISOR_E2E === "true";
const supervisorApiBase = process.env.SUPERVISOR_API_BASE;
const supervisorTimeoutSeconds = parsePositiveInt(process.env.SUPERVISOR_E2E_TIMEOUT_SECONDS, 300);
const supervisorPollSeconds = parsePositiveInt(process.env.SUPERVISOR_E2E_POLL_SECONDS, 5);

const modelConfig: Array<{ name: string; id: string }> = [
  { name: "MODEL_FOUNDRY", id: requireEnv("MODEL_FOUNDRY") },
  { name: "MODEL_GHOSTWRITER", id: requireEnv("MODEL_GHOSTWRITER") },
  { name: "MODEL_EVALUATOR", id: requireEnv("MODEL_EVALUATOR") }
];

async function main(): Promise<void> {
  console.log("Runtime verification start");
  console.log(`Verification mode: ${verifyMode}`);
  console.log(`Region: ${region}`);
  console.log(`Artifact store mode: ${artifactMode}`);
  console.log(`Write probe enabled: ${writeProbeEnabled}`);
  console.log(`Supervisor API e2e enabled: ${supervisorE2EEnabled}`);

  validateLocalConfiguration();

  if (verifyMode === "offline") {
    console.log("Offline verification complete");
    return;
  }

  const bedrock = new BedrockClient({ region });

  for (const model of modelConfig) {
    if (isInferenceProfileId(model.id)) {
      await bedrock.send(new GetInferenceProfileCommand({ inferenceProfileIdentifier: model.id }));
      console.log(`OK: ${model.name} inference profile exists -> ${model.id}`);
      continue;
    }

    await bedrock.send(new GetFoundationModelCommand({ modelIdentifier: model.id }));
    console.log(`OK: ${model.name} foundation model exists -> ${model.id}`);
  }

  if (artifactMode === "dynamodb") {
    const tableName = requireEnv("ARTIFACT_DDB_TABLE");
    const dynamodb = new DynamoDBClient({ region });
    const table = await dynamodb.send(new DescribeTableCommand({ TableName: tableName }));
    const status = table.Table?.TableStatus ?? "UNKNOWN";
    if (status !== "ACTIVE") {
      throw new Error(`DynamoDB table is not ACTIVE: ${tableName} (${status})`);
    }
    console.log(`OK: DynamoDB table active -> ${tableName}`);

    if (writeProbeEnabled) {
      const probeRunId = `verify-${Date.now()}`;
      const probeArtifactId = "runtime-probe";

      await dynamodb.send(
        new PutItemCommand({
          TableName: tableName,
          Item: {
            run_id: { S: probeRunId },
            artifact_id: { S: probeArtifactId },
            kind: { S: "runtime_probe" },
            iteration: { N: "0" },
            persisted_at_utc: { S: new Date().toISOString() }
          }
        })
      );

      await dynamodb.send(
        new DeleteItemCommand({
          TableName: tableName,
          Key: {
            run_id: { S: probeRunId },
            artifact_id: { S: probeArtifactId }
          }
        })
      );

      console.log(`OK: DynamoDB write/delete probe -> ${tableName}`);
    }
  } else {
    console.log("Skipping DynamoDB verification because ARTIFACT_STORE_MODE is not dynamodb");
  }

  if (supervisorE2EEnabled) {
    await verifySupervisorE2E();
  } else {
    console.log("Skipping Supervisor API e2e verification");
  }

  console.log("Runtime verification complete");
}

async function verifySupervisorE2E(): Promise<void> {
  if (!supervisorApiBase?.trim()) {
    throw new Error("SUPERVISOR_API_BASE is required when VERIFY_SUPERVISOR_E2E=true");
  }

  const base = supervisorApiBase.replace(/\/$/, "");
  const action = process.env.SUPERVISOR_E2E_ACTION ?? "develop";
  const chapterId = process.env.SUPERVISOR_E2E_CHAPTER_ID ?? "ch-verify";
  const sceneId = process.env.SUPERVISOR_E2E_SCENE_ID ?? "sc-verify";
  const draft =
    process.env.SUPERVISOR_E2E_DRAFT ??
    "Runtime verification draft. The beacon shudders once before holding steady over the fog.";

  console.log(`Supervisor e2e start: ${base}`);
  const sessionCreated = await httpJson<{ session_id: string }>(`${base}/api/session`, {
    method: "POST",
    body: JSON.stringify({ project_id: "runtime-verify", book_id: "runtime-verify" })
  });

  const sessionId = sessionCreated.session_id;
  if (!sessionId) {
    throw new Error("Supervisor e2e failed to create session");
  }

  const runCreated = await httpJson<{ run_id: string }>(`${base}/api/session/${encodeURIComponent(sessionId)}/message`, {
    method: "POST",
    body: JSON.stringify({
      action,
      chapter_id: chapterId,
      scene_id: sceneId,
      draft
    })
  });

  const runId = runCreated.run_id;
  if (!runId) {
    throw new Error("Supervisor e2e failed to start run");
  }

  console.log(`Supervisor e2e run started -> ${runId}`);

  const started = Date.now();
  const timeoutMs = supervisorTimeoutSeconds * 1000;
  const pollMs = supervisorPollSeconds * 1000;
  let lastStatus = "UNKNOWN";

  while (Date.now() - started < timeoutMs) {
    const statusPayload = await httpJson<{
      status?: string;
      error?: string | null;
      artifacts?: { count?: number; all?: Array<{ kind?: string }> };
    }>(`${base}/api/session/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}`, {
      method: "GET"
    });

    lastStatus = statusPayload.status ?? "UNKNOWN";
    const artifactCount = statusPayload.artifacts?.count ?? 0;
    console.log(`Supervisor e2e poll: status=${lastStatus} artifacts=${artifactCount}`);

    if (lastStatus === "SUCCEEDED") {
      const artifactKinds = new Set((statusPayload.artifacts?.all ?? []).map((entry) => entry.kind).filter(Boolean));
      const requiredKinds = ["foundry-output", "ghostwriter-output", "evaluator-report"];
      for (const kind of requiredKinds) {
        if (!artifactKinds.has(kind)) {
          throw new Error(`Supervisor e2e missing required artifact kind: ${kind}`);
        }
      }

      console.log(`OK: Supervisor API e2e succeeded -> ${runId}`);
      return;
    }

    if (lastStatus === "FAILED" || lastStatus === "TIMED_OUT" || lastStatus === "ABORTED") {
      const message = statusPayload.error ?? "no error message provided";
      throw new Error(`Supervisor e2e run ended with ${lastStatus}: ${message}`);
    }

    await wait(pollMs);
  }

  throw new Error(`Supervisor e2e timed out after ${supervisorTimeoutSeconds}s (last status: ${lastStatus})`);
}

function validateLocalConfiguration(): void {
  for (const model of modelConfig) {
    if (!model.id || model.id.length < 3) {
      throw new Error(`Invalid model identifier for ${model.name}`);
    }

    const validPrefix =
      model.id.startsWith("us.") ||
      model.id.startsWith("global.") ||
      model.id.startsWith("anthropic.") ||
      model.id.startsWith("amazon.") ||
      model.id.includes(":inference-profile/");

    if (!validPrefix) {
      throw new Error(`Model identifier has unexpected format for ${model.name}: ${model.id}`);
    }

    console.log(`OK: ${model.name} configured -> ${model.id}`);
  }

  if (artifactMode === "dynamodb") {
    const tableName = requireEnv("ARTIFACT_DDB_TABLE");
    if (tableName.length < 3) {
      throw new Error("ARTIFACT_DDB_TABLE appears invalid");
    }
    console.log(`OK: DynamoDB table configured -> ${tableName}`);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function httpJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T) : ({} as T);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${text || "empty response"}`);
  }

  return payload;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function isInferenceProfileId(id: string): boolean {
  return id.startsWith("us.") || id.startsWith("global.") || id.includes(":inference-profile/");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
