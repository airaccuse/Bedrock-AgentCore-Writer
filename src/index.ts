import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BedrockAgentRouter, LocalStubAgentRouter } from "./orchestrator/agentRouter.js";
import { createArtifactStoreFromEnvironment } from "./orchestrator/artifactStore.js";
import { runRevisionWorkflow } from "./orchestrator/workflow.js";

loadDotenv({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  const useStub = process.env.USE_LOCAL_STUB_ROUTER !== "false";
  const router = useStub ? new LocalStubAgentRouter() : BedrockAgentRouter.fromEnvironment();
  const artifactStore = createArtifactStoreFromEnvironment();
  const artifactStoreMode = process.env.ARTIFACT_STORE_MODE ?? "local";

  const result = await runRevisionWorkflow(router, {
    runId: "local-demo-run",
    chapterId: "ch-001",
    sceneId: "sc-001",
    draft:
      "Captain Ilya watched the derelict ring flicker back to life as if memory itself had found a circuit.",
    revisionCount: 0,
    maxRevisions: 2
  }, artifactStore);

  console.log("Workflow completed");
  console.log("Router mode:", useStub ? "local-stub" : "bedrock-live");
  console.log("Artifact store mode:", artifactStoreMode);
  console.log("Revisions:", result.revisions);
  console.log("Decision:", result.report.decision);
  console.log("Overall score:", result.report.overall_score);
  console.log("Final draft preview:", result.finalDraft.slice(0, 180));
  console.log("Project root:", path.resolve(__dirname, ".."));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});