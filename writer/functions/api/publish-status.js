import { readPublishRun } from "../lib/github.js";

const COMPLETE_FAILURES = new Set([
  "action_required",
  "cancelled",
  "failure",
  "skipped",
  "stale",
  "startup_failure",
  "timed_out",
]);

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const commit = String(url.searchParams.get("commit") || "").trim();
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    return Response.json({ error: "Invalid commit hash." }, { status: 400 });
  }

  try {
    const run = await readPublishRun(context.env, commit);
    if (!run) {
      return Response.json({ state: "pending" }, { headers: { "Cache-Control": "no-store" } });
    }
    if (run.status !== "completed") {
      return Response.json(
        { state: "building", runUrl: run.url },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const state = run.conclusion === "success" ? "success" : COMPLETE_FAILURES.has(run.conclusion) ? "failure" : "building";
    return Response.json(
      { state, conclusion: run.conclusion, runUrl: run.url },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
