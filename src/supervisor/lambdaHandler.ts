import { randomUUID } from "node:crypto";
import {
  DescribeExecutionCommand,
  SFNClient,
  StartExecutionCommand,
  type ExecutionStatus
} from "@aws-sdk/client-sfn";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

type ActionType = "develop" | "edit" | "evaluate";

interface MessageRequest {
  action: ActionType;
  chapter_id: string;
  scene_id: string;
  draft: string;
  instruction?: string;
  max_revisions?: number;
}

interface ArtifactRecord {
  run_id: string;
  artifact_id: string;
  iteration: number;
  kind: string;
  persisted_at_utc: string;
  payload: unknown;
}

interface HttpEvent {
  requestContext?: { http?: { method?: string } };
  rawPath?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
}

interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const region = requiredEnv("AWS_REGION");
const stateMachineArn = requiredEnv("STATE_MACHINE_ARN");
const artifactTable = requiredEnv("ARTIFACT_DDB_TABLE");
const corsOrigin = process.env.SUPERVISOR_CORS_ORIGIN ?? "*";

const sfn = new SFNClient({ region });
const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

export async function handler(event: HttpEvent): Promise<HttpResponse> {
  const method = event.requestContext?.http?.method ?? "GET";
  const path = event.rawPath ?? "/";

  if (method === "OPTIONS") {
    return response(204, {});
  }

  try {
    if (method === "GET" && path === "/health") {
      return response(200, { ok: true, region, state_machine_arn: stateMachineArn });
    }

    if (method === "POST" && path === "/api/session") {
      const body = parseBody<{ project_id?: string; book_id?: string }>(event);
      return response(201, {
        session_id: randomUUID(),
        created_at_utc: new Date().toISOString(),
        project_id: body.project_id,
        book_id: body.book_id
      });
    }

    const messageMatch = path.match(/^\/api\/session\/([^/]+)\/message$/);
    if (method === "POST" && messageMatch) {
      const sessionId = decodeURIComponent(messageMatch[1]);
      const body = parseBody<MessageRequest>(event);
      validateMessageRequest(body);

      const preparedDraft = prepareDraft(body.action, body.draft, body.instruction);
      const maxRevisions =
        body.action === "evaluate"
          ? 1
          : Number.isInteger(body.max_revisions)
            ? Math.max(1, Number(body.max_revisions))
            : 2;

      const runId = buildRunId();

      const started = await sfn.send(
        new StartExecutionCommand({
          stateMachineArn,
          name: runId,
          input: JSON.stringify({
            runId,
            chapterId: body.chapter_id,
            sceneId: body.scene_id,
            revision: 0,
            maxRevisions,
            draft: preparedDraft
          })
        })
      );

      return response(202, {
        session_id: sessionId,
        run_id: runId,
        execution_arn: started.executionArn ?? executionArnForRun(runId),
        action: body.action
      });
    }

    const runStatusMatch = path.match(/^\/api\/session\/([^/]+)\/runs\/([^/]+)$/);
    if (method === "GET" && runStatusMatch) {
      const sessionId = decodeURIComponent(runStatusMatch[1]);
      const runId = decodeURIComponent(runStatusMatch[2]);
      const executionArn = executionArnForRun(runId);

      let status: ExecutionStatus | "UNKNOWN" = "UNKNOWN";
      let startedAt: string | null = null;
      let stoppedAt: string | null = null;
      let error: string | null = null;

      try {
        const execution = await sfn.send(new DescribeExecutionCommand({ executionArn }));
        status = execution.status ?? "UNKNOWN";
        startedAt = execution.startDate?.toISOString() ?? null;
        stoppedAt = execution.stopDate?.toISOString() ?? null;
        error = execution.error ?? null;
      } catch {
        // Keep UNKNOWN status if run cannot be described yet.
      }

      const artifacts = await fetchArtifactsForRun(runId);

      return response(200, {
        session_id: sessionId,
        run_id: runId,
        execution_arn: executionArn,
        status,
        started_at_utc: startedAt,
        stopped_at_utc: stoppedAt,
        error,
        artifacts: summarizeArtifacts(artifacts)
      });
    }

    return response(404, { error: `Route not found: ${method} ${path}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return response(500, { error: message });
  }
}

function parseBody<T>(event: HttpEvent): T {
  if (!event.body) {
    return {} as T;
  }

  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  return JSON.parse(raw) as T;
}

function response(statusCode: number, payload: unknown): HttpResponse {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": corsOrigin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization"
    },
    body: JSON.stringify(payload, null, 2)
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function validateMessageRequest(body: MessageRequest): void {
  if (!body || (body.action !== "develop" && body.action !== "edit" && body.action !== "evaluate")) {
    throw new Error("Invalid action. Expected one of: develop, edit, evaluate");
  }
  if (!body.chapter_id || !body.scene_id) {
    throw new Error("chapter_id and scene_id are required");
  }
  if (!body.draft || body.draft.trim().length < 10) {
    throw new Error("draft is required and must be at least 10 characters");
  }
}

function buildRunId(): string {
  const stamp = Date.now();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  return `sup-${stamp}-${suffix}`;
}

function prepareDraft(action: ActionType, draft: string, instruction?: string): string {
  if (action !== "edit" || !instruction?.trim()) {
    return draft;
  }

  return [draft, "", "EDITOR_INSTRUCTION:", instruction.trim()].join("\n");
}

function executionArnForRun(runId: string): string {
  // arn:aws:states:region:account:stateMachine:name -> arn:aws:states:region:account:execution:name:runId
  return `${stateMachineArn.replace(":stateMachine:", ":execution:")}:${runId}`;
}

async function fetchArtifactsForRun(runId: string): Promise<ArtifactRecord[]> {
  const records: ArtifactRecord[] = [];
  let cursor: Record<string, unknown> | undefined;

  do {
    const response = await ddbDoc.send(
      new QueryCommand({
        TableName: artifactTable,
        KeyConditionExpression: "run_id = :runId",
        ExpressionAttributeValues: {
          ":runId": runId
        },
        ExclusiveStartKey: cursor
      })
    );

    for (const item of response.Items ?? []) {
      records.push(item as ArtifactRecord);
    }

    cursor = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (cursor);

  return records;
}

function summarizeArtifacts(records: ArtifactRecord[]): {
  count: number;
  latest_by_kind: Record<string, unknown>;
  all: ArtifactRecord[];
} {
  const sorted = [...records].sort((a, b) => {
    if (a.iteration !== b.iteration) {
      return a.iteration - b.iteration;
    }
    return a.artifact_id.localeCompare(b.artifact_id);
  });

  const latestByKind: Record<string, unknown> = {};
  for (const record of sorted) {
    latestByKind[record.kind] = record.payload;
  }

  return {
    count: sorted.length,
    latest_by_kind: latestByKind,
    all: sorted
  };
}
