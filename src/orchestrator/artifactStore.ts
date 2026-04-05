import fs from "node:fs";
import path from "node:path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

export interface ArtifactStore {
  save(runId: string, kind: string, iteration: number, payload: unknown): Promise<string>;
}

export type ArtifactStoreMode = "local" | "dynamodb";

export class LocalFileArtifactStore implements ArtifactStore {
  private readonly rootDir: string;

  constructor(rootDir = path.resolve(process.cwd(), "artifacts")) {
    this.rootDir = rootDir;
  }

  async save(runId: string, kind: string, iteration: number, payload: unknown): Promise<string> {
    const safeKind = kind.replace(/[^a-zA-Z0-9_-]/g, "_");
    const runDir = path.join(this.rootDir, runId);
    fs.mkdirSync(runDir, { recursive: true });

    const filePath = path.join(runDir, `${String(iteration).padStart(2, "0")}-${safeKind}.json`);
    const record = {
      run_id: runId,
      iteration,
      kind,
      persisted_at_utc: new Date().toISOString(),
      payload
    };

    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf8");
    return filePath;
  }
}

export interface DynamoDbArtifactStoreOptions {
  region: string;
  tableName: string;
}

export class DynamoDbArtifactStore implements ArtifactStore {
  private readonly tableName: string;
  private readonly docClient: DynamoDBDocumentClient;

  constructor(options: DynamoDbArtifactStoreOptions) {
    this.tableName = options.tableName;
    const baseClient = new DynamoDBClient({ region: options.region });
    this.docClient = DynamoDBDocumentClient.from(baseClient);
  }

  async save(runId: string, kind: string, iteration: number, payload: unknown): Promise<string> {
    const artifactId = `${runId}#${String(iteration).padStart(2, "0")}#${kind}`;
    const item = {
      run_id: runId,
      artifact_id: artifactId,
      iteration,
      kind,
      persisted_at_utc: new Date().toISOString(),
      payload
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item
      })
    );

    return `dynamodb://${this.tableName}/${artifactId}`;
  }
}

export function createArtifactStoreFromEnvironment(): ArtifactStore {
  const mode = (process.env.ARTIFACT_STORE_MODE ?? "local") as ArtifactStoreMode;

  if (mode === "dynamodb") {
    const region = readRequiredEnv("AWS_REGION");
    const tableName = readRequiredEnv("ARTIFACT_DDB_TABLE");
    return new DynamoDbArtifactStore({ region, tableName });
  }

  return new LocalFileArtifactStore();
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
