import { readRepoFile, writeRepoFile } from "../lib/github.js";
import { formatEntry, isValidISODate, parseEntry, validateEntry } from "../lib/entry-format.js";
import { parseProjectRegistry } from "../lib/projects.js";

function validDate(date) {
  return isValidISODate(date);
}

async function registry(env) {
  const file = await readRepoFile(env, "projects.yml");
  if (!file) throw new Error("projects.yml not found.");
  return parseProjectRegistry(file.text);
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const date = String(url.searchParams.get("date") || "");
  if (!validDate(date)) return Response.json({ error: "Invalid date." }, { status: 400 });

  try {
    const file = await readRepoFile(context.env, `log/${date}.qmd`);
    if (!file) {
      return Response.json({ exists: false, date }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(
      { exists: true, sha: file.sha, entry: parseEntry(file.text) },
      { headers: { "Cache-Control": "no-store" } },
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
    return Response.json({ error: "The submitted content is not valid JSON." }, { status: 400 });
  }

  try {
    const projects = await registry(context.env);
    const errors = validateEntry(input, projects.map((project) => project.slug));
    if (errors.length) return Response.json({ error: errors.join(" "), errors }, { status: 400 });

    const path = `log/${input.date}.qmd`;
    const current = await readRepoFile(context.env, path);
    const submittedSha = String(input.sha || "");
    if ((current && submittedSha !== current.sha) || (!current && submittedSha)) {
      return Response.json(
        { error: "This entry changed elsewhere. Reload it before saving again." },
        { status: 409 },
      );
    }

    const result = await writeRepoFile(context.env, {
      path,
      text: formatEntry(input, projects),
      sha: current?.sha || "",
      message: `${current ? "Update" : "Add"} ODaily entry for ${input.date}`,
    });
    if (result.conflict) {
      return Response.json({ error: "A version conflict occurred while saving. Reload the entry." }, { status: 409 });
    }

    const base = String(context.env.PUBLIC_SITE_URL || "").replace(/\/$/, "");
    return Response.json({
      ok: true,
      sha: result.sha,
      commitSha: result.commitSha,
      commit: result.commit,
      publicUrl: base ? `${base}/log/${input.date}.html` : "",
      message: "Saved. The public site is updating automatically.",
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
