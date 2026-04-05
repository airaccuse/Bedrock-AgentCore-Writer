# Supervisor API MVP

Minimal bridge API for the UI layer to drive the existing multi-stage writing workflow.

## Purpose

- Accept user instructions from a UI session.
- Start Step Functions executions with project-compatible input.
- Expose run status and latest artifacts for display.

## Runtime Requirements

Set these environment variables before starting the server:

- `AWS_REGION`
- `STATE_MACHINE_ARN`
- `ARTIFACT_DDB_TABLE`
- Optional: `SUPERVISOR_API_PORT` (default `8787`)

## Run Locally

```bash
npm run dev:supervisor
```

Base URL: `http://localhost:8787`

## Endpoints

### `GET /health`

Simple liveness/readiness check.

### `POST /api/session`

Creates a new UI session.

Request body:

```json
{
  "project_id": "optional-project",
  "book_id": "optional-book"
}
```

Response:

```json
{
  "session_id": "uuid",
  "created_at_utc": "2026-04-05T23:30:00.000Z",
  "project_id": "optional-project",
  "book_id": "optional-book"
}
```

### `POST /api/session/{session_id}/message`

Starts a new run in Step Functions.

Request body:

```json
{
  "action": "develop",
  "chapter_id": "ch-01",
  "scene_id": "sc-01",
  "draft": "Opening prose or current draft text",
  "instruction": "optional edit instruction",
  "max_revisions": 2
}
```

Notes:

- `action` values: `develop`, `edit`, `evaluate`.
- `edit` appends `instruction` into the working draft context.
- `evaluate` clamps revisions to `1` for quick quality checks.

Response:

```json
{
  "session_id": "uuid",
  "run_id": "uuid-1743895800000",
  "execution_arn": "arn:aws:states:...:execution:...",
  "action": "develop"
}
```

### `GET /api/session/{session_id}/runs/{run_id}`

Returns execution status and artifacts for that run.

Response shape:

```json
{
  "session_id": "uuid",
  "run_id": "uuid-1743895800000",
  "execution_arn": "arn:aws:states:...",
  "status": "RUNNING",
  "started_at_utc": "2026-04-05T23:30:10.000Z",
  "stopped_at_utc": null,
  "error": null,
  "artifacts": {
    "count": 3,
    "latest_by_kind": {
      "ghostwriter-output": { "prose": "..." },
      "evaluator-report": { "decision": "PASS" }
    },
    "all": []
  }
}
```

## MVP Caveats

- Session and run indexes are in-memory only.
- Run status lookup expects runs started through this API instance.
- Add durable session/run persistence in the next hardening pass.
