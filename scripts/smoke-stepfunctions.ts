import { execFileSync } from "node:child_process";

interface ExecutionSummary {
  executionArn: string;
  status: string;
  startDate?: string;
  stopDate?: string;
  error?: string;
  cause?: string;
}

interface RunResult {
  index: number;
  summary: ExecutionSummary;
  durationSeconds?: number;
}

const terraformDir = process.env.TERRAFORM_DIR ?? "infra/terraform";
const stateMachineArn = process.env.STATE_MACHINE_ARN ?? resolveStateMachineArn(terraformDir);

const runId = process.env.SMOKE_RUN_ID ?? `smoke-${Date.now()}`;
const chapterId = process.env.SMOKE_CHAPTER_ID ?? "ch-01";
const sceneId = process.env.SMOKE_SCENE_ID ?? "sc-01";
const draft =
  process.env.SMOKE_DRAFT ??
  "A maintenance drone hovered outside the lighthouse dome as the foghorn stuttered awake.";
const maxRevisions = toPositiveInteger(process.env.SMOKE_MAX_REVISIONS, 1);
const pollSeconds = toPositiveInteger(process.env.SMOKE_POLL_SECONDS, 2);
const timeoutSeconds = toPositiveInteger(process.env.SMOKE_TIMEOUT_SECONDS, 180);
const smokeRuns = toPositiveInteger(process.env.SMOKE_RUNS, 1);

async function main(): Promise<void> {
  const results: RunResult[] = [];

  for (let index = 1; index <= smokeRuns; index += 1) {
    console.log(`===== SMOKE RUN ${index}/${smokeRuns} =====`);

    const executionName = buildExecutionName(index);
    const summary = await runSingleExecution(executionName);
    const durationSeconds = computeDurationSeconds(summary);

    printSummary(summary, durationSeconds);
    results.push({ index, summary, durationSeconds });

    if (summary.status !== "SUCCEEDED") {
      printBatchSummary(results);
      throw new Error(`Smoke execution failed on run ${index} with status ${summary.status}`);
    }

    if (index < smokeRuns) {
      console.log("");
    }
  }

  printBatchSummary(results);
}

async function runSingleExecution(executionName: string): Promise<ExecutionSummary> {
  const input = {
    runId: smokeRuns === 1 ? runId : `${runId}-run-${executionName.slice(-2)}`,
    chapterId,
    sceneId,
    revision: 0,
    maxRevisions,
    draft
  };

  const start = awsJson<{ executionArn: string }>([
    "stepfunctions",
    "start-execution",
    "--state-machine-arn",
    stateMachineArn,
    "--name",
    executionName,
    "--input",
    JSON.stringify(input),
    "--output",
    "json"
  ]);

  const executionArn = start.executionArn;
  console.log(`Started execution: ${executionArn}`);

  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const summary = describeExecution(executionArn);
    if (summary.status !== "RUNNING") {
      return summary;
    }

    await wait(pollSeconds * 1000);
  }

  throw new Error(`Smoke execution did not finish within ${timeoutSeconds} seconds`);
}

function buildExecutionName(index: number): string {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  return `smoke-${stamp}-${String(index).padStart(2, "0")}`;
}

function resolveStateMachineArn(dir: string): string {
  const output = execFileSync(
    "terraform",
    ["-chdir=" + dir, "output", "-raw", "state_machine_arn"],
    { encoding: "utf8" }
  ).trim();

  if (!output) {
    throw new Error("Could not resolve state_machine_arn from Terraform output");
  }

  return output;
}

function describeExecution(executionArn: string): ExecutionSummary {
  return awsJson<ExecutionSummary>([
    "stepfunctions",
    "describe-execution",
    "--execution-arn",
    executionArn,
    "--output",
    "json"
  ]);
}

function awsJson<T>(args: string[]): T {
  const raw = execFileSync("aws", args, { encoding: "utf8" }).trim();
  return JSON.parse(raw) as T;
}

function toPositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`Expected positive integer but got: ${raw}`);
  }

  return parsed;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function printSummary(summary: ExecutionSummary, durationSeconds?: number): void {
  console.log("Execution summary:");
  console.log(`  status: ${summary.status}`);
  console.log(`  startDate: ${summary.startDate ?? "n/a"}`);
  console.log(`  stopDate: ${summary.stopDate ?? "n/a"}`);
  if (typeof durationSeconds === "number") {
    console.log(`  durationSeconds: ${durationSeconds}`);
  }

  if (summary.error) {
    console.log(`  error: ${summary.error}`);
  }

  if (summary.cause) {
    console.log(`  cause: ${summary.cause.slice(0, 1000)}`);
  }
}

function computeDurationSeconds(summary: ExecutionSummary): number | undefined {
  if (!summary.startDate || !summary.stopDate) {
    return undefined;
  }

  const start = Date.parse(summary.startDate);
  const stop = Date.parse(summary.stopDate);
  if (!Number.isFinite(start) || !Number.isFinite(stop) || stop < start) {
    return undefined;
  }

  return Math.round((stop - start) / 1000);
}

function printBatchSummary(results: RunResult[]): void {
  const passCount = results.filter((result) => result.summary.status === "SUCCEEDED").length;
  const failCount = results.length - passCount;
  const durations = results
    .map((result) => result.durationSeconds)
    .filter((value): value is number => typeof value === "number");

  console.log("===== BATCH SUMMARY =====");
  console.log(`  runs: ${results.length}`);
  console.log(`  pass: ${passCount}`);
  console.log(`  fail: ${failCount}`);

  if (durations.length > 0) {
    const min = Math.min(...durations);
    const max = Math.max(...durations);
    const avg = Math.round(durations.reduce((acc, value) => acc + value, 0) / durations.length);
    console.log(`  durationSeconds(min/avg/max): ${min}/${avg}/${max}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
