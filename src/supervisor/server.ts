import { randomUUID } from "node:crypto";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  DescribeExecutionCommand,
  SFNClient,
  StartExecutionCommand,
} from "@aws-sdk/client-sfn";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

type ActionType = "develop" | "edit" | "evaluate";

interface SessionRecord {
  session_id: string;
  created_at_utc: string;
  project_id?: string;
  book_id?: string;
}

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

const region = requiredEnv("AWS_REGION");
const stateMachineArn = requiredEnv("STATE_MACHINE_ARN");
const artifactTable = requiredEnv("ARTIFACT_DDB_TABLE");
const port = Number(process.env.SUPERVISOR_API_PORT ?? "8787");
const corsOrigin = process.env.SUPERVISOR_CORS_ORIGIN ?? "*";

const sfn = new SFNClient({ region });
const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

// MVP in-memory session/run index. Persist externally in a later hardening pass.
const sessions = new Map<string, SessionRecord>();
const runExecutionMap = new Map<string, string>();

const server = createServer(async (req, res) => {
  try {
    applyCors(res);

    if ((req.method ?? "GET") === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    await route(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    sendJson(res, 500, { error: message });
  }
});

server.listen(port, () => {
  console.log(`Supervisor API listening on http://localhost:${port}`);
});

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, region, state_machine_arn: stateMachineArn });
    return;
  }

  if (method === "POST" && url.pathname === "/api/session") {
    const body = await readJsonBody<{ project_id?: string; book_id?: string }>(req);
    const sessionId = randomUUID();
    const session: SessionRecord = {
      session_id: sessionId,
      created_at_utc: new Date().toISOString(),
      project_id: body.project_id,
      book_id: body.book_id
    };

    sessions.set(sessionId, session);
    sendJson(res, 201, session);
    return;
  }

  const messageMatch = url.pathname.match(/^\/api\/session\/([^/]+)\/message$/);
  if (method === "POST" && messageMatch) {
    const sessionId = decodeURIComponent(messageMatch[1]);
    if (!sessions.has(sessionId)) {
      sendJson(res, 404, { error: "Session not found" });
      return;
    }

    const body = await readJsonBody<MessageRequest>(req);
    validateMessageRequest(body);

    const preparedDraft = prepareDraft(body.action, body.draft, body.instruction);
    const maxRevisions =
      body.action === "evaluate"
        ? 1
        : Number.isInteger(body.max_revisions)
          ? Math.max(1, Number(body.max_revisions))
          : 2;

    const runId = `${sessionId}-${Date.now()}`;
    const executionName = buildExecutionName(sessionId);

    const input = {
      runId,
      chapterId: body.chapter_id,
      sceneId: body.scene_id,
      revision: 0,
      maxRevisions,
      draft: preparedDraft
    };

    const started = await sfn.send(
      new StartExecutionCommand({
        stateMachineArn,
        name: executionName,
        input: JSON.stringify(input)
      })
    );

    if (!started.executionArn) {
      throw new Error("Step Functions did not return execution ARN");
    }

    runExecutionMap.set(runId, started.executionArn);

    sendJson(res, 202, {
      session_id: sessionId,
      run_id: runId,
      execution_arn: started.executionArn,
      action: body.action
    });
    return;
  }

  const runStatusMatch = url.pathname.match(/^\/api\/session\/([^/]+)\/runs\/([^/]+)$/);
  if (method === "GET" && runStatusMatch) {
    const sessionId = decodeURIComponent(runStatusMatch[1]);
    const runId = decodeURIComponent(runStatusMatch[2]);

    if (!sessions.has(sessionId)) {
      sendJson(res, 404, { error: "Session not found" });
      return;
    }

    const executionArn = runExecutionMap.get(runId);
    const execution = executionArn
      ? await sfn.send(new DescribeExecutionCommand({ executionArn }))
      : undefined;

    const artifacts = await fetchArtifactsForRun(runId);

    sendJson(res, 200, {
      session_id: sessionId,
      run_id: runId,
      execution_arn: executionArn ?? null,
      status: execution?.status ?? "UNKNOWN",
      started_at_utc: execution?.startDate?.toISOString() ?? null,
      stopped_at_utc: execution?.stopDate?.toISOString() ?? null,
      error: execution?.error ?? null,
      artifacts: summarizeArtifacts(artifacts)
    });
    return;
  }

  sendJson(res, 404, { error: `Route not found: ${method} ${url.pathname}` });
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {} as T;
  }

  return JSON.parse(raw) as T;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(body);
}

function applyCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", corsOrigin);
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,authorization");
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

function prepareDraft(action: ActionType, draft: string, instruction?: string): string {
  if (action !== "edit" || !instruction?.trim()) {
    return draft;
  }

  return [
    draft,
    "",
    "EDITOR_INSTRUCTION:",
    instruction.trim()
  ].join("\n");
}

function buildExecutionName(sessionId: string): string {
  const compactSession = sessionId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 20);
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  return `sup-${compactSession}-${stamp}`.slice(0, 80);
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
