const apiBaseInput = document.getElementById("apiBase");
const actionInput = document.getElementById("action");
const chapterIdInput = document.getElementById("chapterId");
const sceneIdInput = document.getElementById("sceneId");
const draftInput = document.getElementById("draft");
const instructionInput = document.getElementById("instruction");
const runBtn = document.getElementById("runBtn");

const statusLine = document.getElementById("statusLine");
const meta = document.getElementById("meta");
const draftOut = document.getElementById("draftOut");
const evalOut = document.getElementById("evalOut");
const rawOut = document.getElementById("rawOut");

const defaultApiBase = localStorage.getItem("supervisor-api-base") || "http://localhost:8787";
apiBaseInput.value = defaultApiBase;

let activeSessionId = null;

runBtn.addEventListener("click", async () => {
  runBtn.disabled = true;
  try {
    const base = normalizeApiBase(apiBaseInput.value);
    localStorage.setItem("supervisor-api-base", base);

    setStatus("Creating session...");
    if (!activeSessionId) {
      activeSessionId = await createSession(base);
    }

    setStatus("Submitting supervisor request...");
    const run = await submitMessage(base, activeSessionId, {
      action: actionInput.value,
      chapter_id: chapterIdInput.value.trim(),
      scene_id: sceneIdInput.value.trim(),
      draft: draftInput.value,
      instruction: instructionInput.value.trim() || undefined,
      max_revisions: 2
    });

    setStatus(`Run submitted: ${run.run_id}. Polling status...`);
    await pollRun(base, activeSessionId, run.run_id);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unexpected error");
  } finally {
    runBtn.disabled = false;
  }
});

async function createSession(base) {
  const res = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project_id: "mvp", book_id: "book-01" })
  });

  if (!res.ok) {
    throw new Error(`Failed to create session (${res.status})`);
  }

  const json = await res.json();
  return json.session_id;
}

async function submitMessage(base, sessionId, body) {
  const res = await fetch(`${base}/api/session/${encodeURIComponent(sessionId)}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const detail = await safeJson(res);
    throw new Error(detail.error || `Failed to submit message (${res.status})`);
  }

  return res.json();
}

async function pollRun(base, sessionId, runId) {
  const started = Date.now();
  while (true) {
    const res = await fetch(
      `${base}/api/session/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}`
    );

    if (!res.ok) {
      const detail = await safeJson(res);
      throw new Error(detail.error || `Failed to read run status (${res.status})`);
    }

    const json = await res.json();
    renderResult(json);

    if (["SUCCEEDED", "FAILED", "TIMED_OUT", "ABORTED"].includes(json.status)) {
      const elapsed = Math.round((Date.now() - started) / 1000);
      setStatus(`Run ${json.status} in ${elapsed}s`);
      return;
    }

    await wait(2500);
  }
}

function renderResult(result) {
  const artifacts = result.artifacts?.latest_by_kind || {};
  const prose =
    artifacts["style-output"]?.prose ||
    artifacts["continuity-output"]?.prose ||
    artifacts["compression-output"]?.prose ||
    artifacts["ghostwriter-output"]?.prose ||
    "No prose output yet.";

  const evaluator = artifacts["evaluator-report"] || { note: "No evaluator report yet." };

  meta.textContent = [
    `Session: ${result.session_id}`,
    `Run: ${result.run_id}`,
    `Status: ${result.status}`
  ].join(" | ");

  draftOut.textContent = typeof prose === "string" ? prose : JSON.stringify(prose, null, 2);
  evalOut.textContent = JSON.stringify(evaluator, null, 2);
  rawOut.textContent = JSON.stringify(artifacts, null, 2);
}

function setStatus(text) {
  statusLine.textContent = text;
}

function normalizeApiBase(raw) {
  const value = (raw || "").trim().replace(/\/$/, "");
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    throw new Error("Supervisor API Base URL must start with http:// or https://");
  }
  return value;
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
