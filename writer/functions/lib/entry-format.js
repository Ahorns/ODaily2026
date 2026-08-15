export const SECTION_KEYS = {
  "The start": "start",
  "What I did": "did",
  "What I did well": "well",
  "What I learned": "learned",
  "An idea that came up": "idea",
  Other: "other",
};

function booleanValue(value) {
  return /^(true|yes|1)$/i.test(String(value || "").trim());
}

function unquote(value) {
  const text = String(value || "").trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1);
  return text;
}

function parseSessions(comment) {
  const sessions = [];
  let current = null;
  for (const rawLine of String(comment || "").replace(/\r/g, "").split("\n")) {
    const project = rawLine.match(/^\s*-\s+project:\s*(.+?)\s*$/);
    if (project) {
      current = { project: unquote(project[1]), hours: 0, note: "", category: "" };
      sessions.push(current);
      continue;
    }
    if (!current) continue;
    const property = rawLine.match(/^\s+(hours|note|category):\s*(.*?)\s*$/);
    if (!property) {
      if (!rawLine.trim()) current = null;
      continue;
    }
    if (property[1] === "hours") current.hours = Number(property[2]) || 0;
    else current[property[1]] = unquote(property[2]);
  }
  return sessions;
}

function splitSections(body) {
  const sections = { start: "", did: "", well: "", learned: "", idea: "", other: "" };
  const matches = [...body.matchAll(/^##\s+(.+?)\s*$/gm)]
    .filter((match) => SECTION_KEYS[match[1].trim()]);
  matches.forEach((match, index) => {
    const key = SECTION_KEYS[match[1].trim()];
    if (!key) return;
    const begin = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? body.length;
    sections[key] = body.slice(begin, end).trim();
  });
  const time = sections.did.match(/<!--\s*time\b([\s\S]*?)-->/i);
  const sessions = parseSessions(time?.[1] || "");
  sections.did = sections.did.replace(/<!--\s*time\b[\s\S]*?-->/i, "").trim();
  return { sections, sessions };
}

export function parseEntry(text) {
  const source = String(text || "").replace(/\r/g, "");
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  if (frontmatter) {
    for (const line of frontmatter[1].split("\n")) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
      if (match) meta[match[1]] = unquote(match[2]);
    }
  }
  const { sections, sessions } = splitSections(
    frontmatter ? source.slice(frontmatter[0].length) : source,
  );
  return {
    date: String(meta.date || ""),
    milestone: booleanValue(meta.milestone),
    sections,
    sessions,
  };
}

function longDate(isoDate) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(date);
  const take = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${take("weekday")} ${take("day")} ${take("month")} ${take("year")}`;
}

function cleanBody(value) {
  return String(value || "").replace(/\r/g, "").trim();
}

export function validateEntry(input, projectSlugs = []) {
  const errors = [];
  const date = String(input?.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    errors.push("Invalid date.");
  }
  const allowed = new Set(projectSlugs);
  const sessions = Array.isArray(input?.sessions) ? input.sessions : [];
  let total = 0;
  sessions.forEach((session, index) => {
    const project = String(session?.project || "").trim();
    const hours = Number(session?.hours);
    if (!project) errors.push(`Project ${index + 1} has no name.`);
    if (allowed.size && !allowed.has(project)) errors.push(`Unknown project: ${project}`);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
      errors.push(`Project ${project || index + 1} has invalid hours.`);
    } else {
      total += hours;
    }
    if (String(session?.note || "").length > 500) errors.push(`The note for project ${project || index + 1} is too long.`);
  });
  if (total > 24) errors.push("Total project time cannot exceed 24 hours in one day.");
  for (const [key, value] of Object.entries(input?.sections || {})) {
    if (String(value || "").length > 20000) errors.push(`${key} is too long.`);
  }
  return errors;
}

export function formatEntry(input, projects = []) {
  const sections = input.sections || {};
  const sessions = (input.sessions || []).filter((session) => String(session.project || "").trim());
  const sessionLines = sessions.flatMap((session) => {
    const lines = [
      `  - project: ${String(session.project).trim()}`,
      `    hours: ${Number(session.hours) || 0}`,
    ];
    if (String(session.category || "").trim()) lines.push(`    category: ${String(session.category).trim()}`);
    lines.push(`    note: ${JSON.stringify(String(session.note || ""))}`);
    return lines;
  });
  if (!sessionLines.length) {
    sessionLines.push("  - project: other", "    hours: 0", '    note: ""');
  }
  const byGroup = new Map();
  for (const project of projects) {
    if (!byGroup.has(project.group)) byGroup.set(project.group, []);
    byGroup.get(project.group).push(project.slug);
  }
  const projectGuide = [...byGroup.entries()]
    .map(([group, slugs]) => `  ${group}  ${slugs.join(", ")}`)
    .join("\n");

  return `---
title: ${JSON.stringify(longDate(input.date))}
date: ${input.date}
milestone: ${input.milestone ? "true" : "false"}
---

## The start

${cleanBody(sections.start)}

## What I did

<!-- time
${sessionLines.join("\n")}

${projectGuide}
-->

${cleanBody(sections.did)}

## What I did well

${cleanBody(sections.well)}

## What I learned

${cleanBody(sections.learned)}

## An idea that came up

${cleanBody(sections.idea)}

## Other

${cleanBody(sections.other)}
`;
}
