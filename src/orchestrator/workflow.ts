import type { EvaluatorReport, WorkflowState } from "../contracts/types.js";
import type { AgentRouter } from "./agentRouter.js";
import type { ArtifactStore } from "./artifactStore.js";

export async function runRevisionWorkflow(
  router: AgentRouter,
  initialState: WorkflowState,
  artifactStore: ArtifactStore
): Promise<{ finalDraft: string; report: EvaluatorReport; revisions: number }> {
  let draft = initialState.draft;
  let revisions = 0;
  const foundryPlan = await router.invoke("NARRATIVE_FOUNDRY", {
    runId: initialState.runId,
    chapterId: initialState.chapterId,
    sceneId: initialState.sceneId,
    seedDraft: initialState.draft
  });
  await artifactStore.save(initialState.runId, "foundry-output", 0, foundryPlan);

  let report = (await router.invoke("EVALUATOR", { draft })) as EvaluatorReport;
  await artifactStore.save(initialState.runId, "evaluator-report", revisions, report);

  while (report.decision === "REWRITE" && revisions < initialState.maxRevisions) {
    const rewritePayload = {
      draft,
      runId: initialState.runId,
      chapterId: initialState.chapterId,
      sceneId: initialState.sceneId,
      foundry_plan: foundryPlan,
      directives: report.rewrite_directives
    };
    await artifactStore.save(
      initialState.runId,
      "rewrite-directives",
      revisions + 1,
      report.rewrite_directives
    );

    const ghostwriterResult = (await router.invoke("GHOSTWRITER", rewritePayload)) as {
      prose?: string;
    };
    await artifactStore.save(initialState.runId, "ghostwriter-output", revisions + 1, ghostwriterResult);

    const compressionResult = (await router.invoke("COMPRESSION", {
      runId: initialState.runId,
      chapterId: initialState.chapterId,
      sceneId: initialState.sceneId,
      draft: ghostwriterResult.prose ?? draft,
      directives: report.rewrite_directives
    })) as { prose?: string };
    await artifactStore.save(initialState.runId, "compression-output", revisions + 1, compressionResult);

    const continuityResult = (await router.invoke("CONTINUITY", {
      runId: initialState.runId,
      chapterId: initialState.chapterId,
      sceneId: initialState.sceneId,
      draft: compressionResult.prose ?? ghostwriterResult.prose ?? draft,
      foundry_plan: foundryPlan
    })) as { prose?: string };
    await artifactStore.save(initialState.runId, "continuity-output", revisions + 1, continuityResult);

    const styleResult = (await router.invoke("STYLE", {
      runId: initialState.runId,
      chapterId: initialState.chapterId,
      sceneId: initialState.sceneId,
      draft: continuityResult.prose ?? compressionResult.prose ?? ghostwriterResult.prose ?? draft
    })) as { prose?: string };
    await artifactStore.save(initialState.runId, "style-output", revisions + 1, styleResult);

    draft = styleResult.prose ?? continuityResult.prose ?? compressionResult.prose ?? ghostwriterResult.prose ?? draft;
    revisions += 1;
    report = (await router.invoke("EVALUATOR", { draft })) as EvaluatorReport;
    await artifactStore.save(initialState.runId, "evaluator-report", revisions, report);
  }

  return {
    finalDraft: draft,
    report,
    revisions
  };
}