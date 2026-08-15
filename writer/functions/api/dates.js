import { listRepoDirectory } from "../lib/github.js";

export async function onRequestGet(context) {
  try {
    const items = await listRepoDirectory(context.env, "log");
    const dates = items
      .map((item) => item.name?.match(/^(\d{4}-\d{2}-\d{2})\.qmd$/)?.[1])
      .filter(Boolean)
      .sort()
      .reverse();
    return Response.json({ dates }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
