import { readRepoFile } from "../lib/github.js";
import { parseProjectRegistry } from "../lib/projects.js";

export async function onRequestGet(context) {
  try {
    const file = await readRepoFile(context.env, "projects.yml");
    if (!file) return Response.json({ error: "projects.yml not found." }, { status: 404 });
    return Response.json(
      { projects: parseProjectRegistry(file.text) },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
