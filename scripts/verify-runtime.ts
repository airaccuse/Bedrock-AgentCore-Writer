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

  console.log("Runtime verification complete");
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

function isInferenceProfileId(id: string): boolean {
  return id.startsWith("us.") || id.startsWith("global.") || id.includes(":inference-profile/");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
