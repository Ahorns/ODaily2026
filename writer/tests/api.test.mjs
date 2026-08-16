import test from "node:test";
import assert from "node:assert/strict";

import { onRequest as authorize } from "../functions/api/_middleware.js";
import { onRequestPut as saveEntry } from "../functions/api/entry.js";
import { onRequestGet as publishStatus } from "../functions/api/publish-status.js";
import { onRequestPut as saveProjects } from "../functions/api/projects.js";
import { parseEntry } from "../functions/lib/entry-format.js";

const env = {
  GITHUB_TOKEN: "secret",
  GITHUB_OWNER: "Ahorns",
  GITHUB_REPO: "ODaily2026",
  GITHUB_BRANCH: "main",
  WRITER_EMAIL: "writer@example.com",
  PUBLIC_SITE_URL: "https://odaily2026.pages.dev",
};

const projects = `
groups:
  craft:
    name: "Craft"
projects:
  odaily:
    name: "ODaily"
    group: craft
    category: coding
    color: "#4fc3f7"
    status: active
`;

function base64(text) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function fromBase64(text) {
  const bytes = Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

test("API middleware requires the configured Cloudflare Access email", async () => {
  const missing = await authorize({
    env,
    request: new Request("https://writer.example/api/projects"),
    data: {},
    next: () => new Response("ok"),
  });
  assert.equal(missing.status, 401);

  const data = {};
  const allowed = await authorize({
    env,
    request: new Request("https://writer.example/api/projects", {
      headers: { "Cf-Access-Authenticated-User-Email": "Writer@Example.com" },
    }),
    data,
    next: () => new Response("ok"),
  });
  assert.equal(allowed.status, 200);
  assert.equal(data.writerEmail, "writer@example.com");
});

test("save endpoint creates a QMD file and returns its public URL", async () => {
  const originalFetch = globalThis.fetch;
  let written = null;
  globalThis.fetch = async (url, init = {}) => {
    const address = String(url);
    if (address.includes("contents/projects.yml")) {
      return Response.json({ content: base64(projects), sha: "projects-sha" });
    }
    if (address.includes("contents/log/2026-08-15.qmd") && !init.method) {
      return new Response("Not found", { status: 404 });
    }
    if (address.includes("contents/log/2026-08-15.qmd") && init.method === "PUT") {
      written = JSON.parse(init.body);
      return Response.json({
        content: { sha: "entry-sha", html_url: "https://github.example/entry" },
        commit: { sha: "a".repeat(40), html_url: "https://github.example/commit" },
      });
    }
    return new Response("Unexpected request", { status: 500 });
  };

  const payload = {
    date: "2026-08-15",
    milestone: false,
    sha: "",
    sections: {
      start: "Start",
      did: "Built it",
      well: "Saved once",
      learned: "API flow",
      idea: "Less friction",
      other: "中文内容",
    },
    sessions: [{ project: "odaily", hours: 2, note: "Writer" }],
  };

  try {
    const response = await saveEntry({
      env,
      request: new Request("https://writer.example/api/entry", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.sha, "entry-sha");
    assert.equal(result.commitSha, "a".repeat(40));
    assert.equal(result.publicUrl, "https://odaily2026.pages.dev/log/2026-08-15.html");
    assert.ok(written);
    assert.deepEqual(parseEntry(fromBase64(written.content)), {
      date: payload.date,
      milestone: false,
      sections: payload.sections,
      sessions: [{ project: "odaily", hours: 2, note: "Writer", category: "" }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("publish status reports the real public-site workflow result", async () => {
  const originalFetch = globalThis.fetch;
  const commit = "b".repeat(40);
  globalThis.fetch = async (url, init = {}) => {
    const address = String(url);
    assert.match(address, /actions\/workflows\/publish-site\.yml\/runs/);
    assert.match(address, new RegExp(`head_sha=${commit}`));
    assert.equal(init.headers.Authorization, undefined);
    return Response.json({
      workflow_runs: [{ status: "completed", conclusion: "success", html_url: "https://github.example/run" }],
    });
  };

  try {
    const response = await publishStatus({
      env,
      request: new Request(`https://writer.example/api/publish-status?commit=${commit}`),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      state: "success",
      conclusion: "success",
      runUrl: "https://github.example/run",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("project manager saves a new project through the Contents API", async () => {
  const originalFetch = globalThis.fetch;
  let written = null;
  globalThis.fetch = async (url, init = {}) => {
    const address = String(url);
    if (address.includes("contents/projects.yml") && !init.method) {
      return Response.json({ content: base64(projects), sha: "projects-sha" });
    }
    if (address.includes("contents/projects.yml") && init.method === "PUT") {
      written = JSON.parse(init.body);
      return Response.json({
        content: { sha: "projects-new-sha", html_url: "https://github.example/projects" },
        commit: { sha: "c".repeat(40), html_url: "https://github.example/projects-commit" },
      });
    }
    return new Response("Unexpected request", { status: 500 });
  };

  try {
    const registry = {
      groups: { craft: { name: "Craft", blurb: "" } },
      projects: {
        odaily: {
          name: "ODaily",
          group: "craft",
          category: "coding",
          color: "#4fc3f7",
          status: "active",
          blurb: "",
        },
        english: {
          name: "English Learning",
          group: "craft",
          category: "reading",
          color: "#7fd8f7",
          status: "active",
          blurb: "Vocabulary practice.",
        },
      },
    };
    const response = await saveProjects({
      env,
      request: new Request("https://writer.example/api/projects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: "projects-sha", registry }),
      }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.sha, "projects-new-sha");
    assert.ok(written);
    const encoded = Uint8Array.from(atob(written.content), (character) => character.charCodeAt(0));
    assert.match(new TextDecoder().decode(encoded), /English Learning/);
    assert.match(new TextDecoder().decode(encoded), /Vocabulary practice/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
