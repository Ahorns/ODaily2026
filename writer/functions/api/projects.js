import { readRepoFile, writeRepoFile } from "../lib/github.js";
import {
  parseProjectDocument,
  parseProjectRegistry,
  serializeProjectDocument,
  validateProjectDocument,
} from "../lib/projects.js";

export async function onRequestGet(context) {
  try {
    const file = await readRepoFile(context.env, "projects.yml");
    if (!file) return Response.json({ error: "projects.yml not found." }, { status: 404 });
    return Response.json(
      { projects: parseProjectRegistry(file.text), registry: parseProjectDocument(file.text), sha: file.sha },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}

export async function onRequestPut(context) {
  let input;
  try {
    input = await context.request.json();
  } catch {
    return Response.json({ error: "The submitted project data is not valid JSON." }, { status: 400 });
  }

  const registry = input?.registry;
  const errors = validateProjectDocument(registry);
  if (errors.length) return Response.json({ error: errors.join(" "), errors }, { status: 400 });

  try {
    const current = await readRepoFile(context.env, "projects.yml");
    const submittedSha = String(input.sha || "");
    if (!current || (submittedSha && submittedSha !== current.sha) || (!submittedSha && current)) {
      return Response.json({ error: "The project list changed elsewhere. Reload it before saving again." }, { status: 409 });
    }

    const result = await writeRepoFile(context.env, {
      path: "projects.yml",
      text: serializeProjectDocument(registry),
      sha: current.sha,
      message: "Update ODaily project registry",
    });
    if (result.conflict) {
      return Response.json({ error: "A project-list conflict occurred. Reload the manager and try again." }, { status: 409 });
    }
    return Response.json({
      ok: true,
      sha: result.sha,
      commitSha: result.commitSha,
      commit: result.commit,
      projects: parseProjectRegistry(serializeProjectDocument(registry)),
      message: "Project list saved. The galaxy is rebuilding automatically.",
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
