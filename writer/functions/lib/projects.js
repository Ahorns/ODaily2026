function scalar(raw) {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value === "true") return true;
  if (value === "false") return false;
  return value.replace(/\s+#.*$/, "").trim();
}

export function parseProjectRegistry(text) {
  const groups = {};
  const projects = {};
  let section = "";
  let current = "";

  for (const rawLine of String(text).replace(/\r/g, "").split("\n")) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const top = rawLine.match(/^(groups|projects):\s*$/);
    if (top) {
      section = top[1];
      current = "";
      continue;
    }
    const item = rawLine.match(/^  ([^\s#][^:]*):\s*$/);
    if (item && section) {
      current = item[1].trim();
      if (section === "groups") groups[current] = {};
      if (section === "projects") projects[current] = {};
      continue;
    }
    const property = rawLine.match(/^    ([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (!property || !current) continue;
    const target = section === "groups" ? groups[current] : projects[current];
    if (target) target[property[1]] = scalar(property[2]);
  }

  return Object.entries(projects)
    .map(([slug, project]) => ({
      slug,
      name: String(project.name || slug),
      group: String(groups[project.group]?.name || project.group || "Other"),
      category: String(project.category || "admin"),
      color: String(project.color || "#7d8aa8"),
      status: String(project.status || "active"),
    }))
    .filter((project) => project.status !== "archived")
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}
