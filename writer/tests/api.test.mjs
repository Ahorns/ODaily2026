import test from "node:test";
import assert from "node:assert/strict";

import { onRequest as authorize } from "../functions/api/_middleware.js";
import { onRequestPut as saveEntry } from "../functions/api/entry.js";
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
        commit: { html_url: "https://github.example/commit" },
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
