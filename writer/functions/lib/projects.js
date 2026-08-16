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

export function parseProjectDocument(text) {
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

  return { groups, projects };
}

export function parseProjectRegistry(text) {
  const document = parseProjectDocument(text);
  return Object.entries(document.projects)
    .map(([slug, project]) => ({
      slug,
      name: String(project.name || slug),
      group: String(document.groups[project.group]?.name || project.group || "Other"),
      category: String(project.category || "admin"),
      color: String(project.color || "#7d8aa8"),
      started: String(project.started || ""),
      blurb: String(project.blurb || ""),
      status: String(project.status || "active"),
    }))
    .filter((project) => project.status !== "archived")
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

function quote(value) {
  return JSON.stringify(String(value ?? ""));
}

export function validateProjectDocument(registry) {
  const errors = [];
  if (!registry || typeof registry !== "object") return ["Project registry is required."];
  if (!registry.groups || typeof registry.groups !== "object") errors.push("At least one project group is required.");
  if (!registry.projects || typeof registry.projects !== "object") errors.push("At least one project is required.");
  if (errors.length) return errors;

  const groupKeys = Object.keys(registry.groups);
  if (!groupKeys.length) errors.push("At least one project group is required.");
  for (const key of groupKeys) {
    const group = registry.groups[key] || {};
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(key)) errors.push("Invalid group key: " + key);
    if (!String(group.name || "").trim()) errors.push("Group " + key + " needs a name.");
  }

  const projectKeys = Object.keys(registry.projects);
  if (!projectKeys.length) errors.push("At least one project is required.");
  for (const key of projectKeys) {
    const project = registry.projects[key] || {};
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(key)) errors.push("Invalid project slug: " + key);
    if (!String(project.name || "").trim()) errors.push("Project " + key + " needs a name.");
    if (!groupKeys.includes(String(project.group || ""))) errors.push("Project " + key + " refers to an unknown group.");
    if (!String(project.category || "").trim()) errors.push("Project " + key + " needs a type.");
    if (project.color && !/^#[0-9a-f]{6}$/i.test(String(project.color))) errors.push("Project " + key + " needs a six-digit hex color.");
    if (project.status && !["active", "archived"].includes(String(project.status))) errors.push("Project " + key + " has an invalid status.");
    if (project.started && !/^\d{4}-\d{2}-\d{2}$/.test(String(project.started))) errors.push("Project " + key + " has an invalid start date.");
    if (String(project.name || "").length > 120) errors.push("Project " + key + " has a name that is too long.");
    if (String(project.blurb || "").length > 500) errors.push("Project " + key + " has a description that is too long.");
  }
  return errors;
}

export function serializeProjectDocument(registry) {
  const lines = [
    "# Constellation registry.",
    "# Managed from the private ODaily editor.",
    "",
    "groups:",
  ];
  for (const [key, groupValue] of Object.entries(registry.groups || {})) {
    const group = groupValue || {};
    lines.push("  " + key + ":");
    lines.push("    name: " + quote(group.name || key));
    if (group.blurb) lines.push("    blurb: " + quote(group.blurb));
  }
  lines.push("", "projects:");
  for (const [key, projectValue] of Object.entries(registry.projects || {})) {
    const project = projectValue || {};
    lines.push("  " + key + ":");
    lines.push("    name: " + quote(project.name || key));
    lines.push("    group: " + String(project.group || "others"));
    lines.push("    category: " + quote(project.category || "admin"));
    lines.push("    color: " + quote(project.color || "#7d8aa8"));
    if (project.started) lines.push("    started: " + String(project.started));
    lines.push("    status: " + String(project.status || "active"));
    if (project.blurb) lines.push("    blurb: " + quote(project.blurb));
  }
  return lines.join("\n") + "\n";
}
