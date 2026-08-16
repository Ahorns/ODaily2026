import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { formatEntry, parseEntry, validateEntry } from "../functions/lib/entry-format.js";
import {
  parseProjectDocument,
  parseProjectRegistry,
  serializeProjectDocument,
  validateProjectDocument,
} from "../functions/lib/projects.js";
import { readRepoFile, writeRepoFile } from "../functions/lib/github.js";

const here = dirname(fileURLToPath(import.meta.url));

const registryText = `
groups:
  research:
    name: "Research"
  craft:
    name: "Craft"
projects:
  odaily:
    name: "ODaily"
    group: craft
    category: coding
    color: "#4fc3f7"
    status: active
  3DIC:
    name: "3DIC"
    group: research
    category: coding
    color: "#e07a5f"
    status: active
`;

test("project registry parser keeps slugs, groups and metadata", () => {
  const projects = parseProjectRegistry(registryText);
  assert.deepEqual(projects.map((project) => project.slug).sort(), ["3DIC", "odaily"]);
  assert.equal(projects.find((project) => project.slug === "odaily").group, "Craft");
  assert.equal(projects.find((project) => project.slug === "3DIC").category, "coding");
});

test("project registry edits round-trip names, descriptions and colors", () => {
  const document = parseProjectDocument(registryText);
  document.groups.study = { name: "Study", blurb: "Learning time." };
  document.projects.english = {
    name: "English Learning",
    group: "study",
    category: "reading",
    color: "#7fd8f7",
    status: "active",
    blurb: "Vocabulary and speaking practice.",
  };
  assert.deepEqual(validateProjectDocument(document), []);
  const rebuilt = parseProjectDocument(serializeProjectDocument(document));
  assert.equal(rebuilt.groups.study.name, "Study");
  assert.equal(rebuilt.projects.english.name, "English Learning");
  assert.equal(rebuilt.projects.english.blurb, "Vocabulary and speaking practice.");
  assert.equal(rebuilt.projects.english.color, "#7fd8f7");
});

test("entry format round-trips prose, milestone and sessions", () => {
  const projects = parseProjectRegistry(registryText);
  const input = {
    date: "2026-08-15",
    milestone: true,
    sections: {
      start: "Started slowly.",
      did: "Fixed the recorder.\n\n## A smaller heading\n\nKept the prose intact.",
      well: "Finished it.",
      learned: "Cloudflare Functions.",
      idea: "Make saving invisible.",
      other: "中文也应该正常。",
    },
    sessions: [
      { project: "odaily", hours: 2.5, note: "Built the form", category: "coding" },
      { project: "3DIC", hours: 1, note: "Read results", category: "" },
    ],
  };
  const qmd = formatEntry(input, projects);
  const parsed = parseEntry(qmd);
  assert.equal(parsed.date, input.date);
  assert.equal(parsed.milestone, true);
  assert.deepEqual(parsed.sections, input.sections);
  assert.deepEqual(parsed.sessions, input.sessions);
  assert.match(qmd, /title: "Saturday 15 August 2026"/);
});

test("existing ODaily entries can be parsed and formatted again", async () => {
  const projectText = await readFile(join(here, "..", "..", "projects.yml"), "utf8");
  const projects = parseProjectRegistry(projectText);
  for (const date of ["2026-08-04", "2026-08-05", "2026-08-08"]) {
    const source = await readFile(join(here, "..", "..", "log", `${date}.qmd`), "utf8");
    const parsed = parseEntry(source);
    assert.equal(parsed.date, date);
    const rebuilt = formatEntry(parsed, projects);
    assert.deepEqual(parseEntry(rebuilt), parsed);
  }
});

test("GitHub helper uses the Contents API branch query and UTF-8 base64", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (!init.method) {
      return Response.json({ content: btoa(String.fromCharCode(...new TextEncoder().encode("中文"))), sha: "old" });
    }
    return Response.json({ content: { sha: "new", html_url: "content" }, commit: { html_url: "commit" } });
  };
  const env = { GITHUB_TOKEN: "secret", GITHUB_OWNER: "Ahorns", GITHUB_REPO: "ODaily2026", GITHUB_BRANCH: "main" };
  try {
    const file = await readRepoFile(env, "log/2026-08-15.qmd");
    assert.equal(file.text, "中文");
    assert.match(calls[0].url, /contents\/log\/2026-08-15\.qmd\?ref=main$/);

    const result = await writeRepoFile(env, {
      path: "log/2026-08-15.qmd",
      text: "中文",
      sha: "old",
      message: "Update entry",
    });
    assert.equal(result.sha, "new");
    const payload = JSON.parse(calls[1].init.body);
    const bytes = Uint8Array.from(atob(payload.content), (character) => character.charCodeAt(0));
    assert.equal(new TextDecoder().decode(bytes), "中文");
    assert.equal(payload.sha, "old");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validation rejects impossible totals and unknown projects", () => {
  const errors = validateEntry(
    {
      date: "2026-08-15",
      sections: {},
      sessions: [
        { project: "odaily", hours: 20, note: "" },
        { project: "missing", hours: 5, note: "" },
      ],
    },
    ["odaily"],
  );
  assert.ok(errors.some((error) => error.includes("Unknown project")));
  assert.ok(errors.some((error) => error.includes("24")));
});
