const API_VERSION = "2022-11-28";

function settings(env) {
  const token = String(env.GITHUB_TOKEN || "").trim();
  const owner = String(env.GITHUB_OWNER || "Ahorns").trim();
  const repo = String(env.GITHUB_REPO || "ODaily2026").trim();
  const branch = String(env.GITHUB_BRANCH || "main").trim();

  if (!token) throw new Error("GITHUB_TOKEN is not configured.");
  if (!owner || !repo || !branch) throw new Error("GitHub repository settings are incomplete.");
  return { token, owner, repo, branch };
}

function headers(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "ODaily-Writer",
  };
}

function contentUrl(config, path, ref = "") {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const base = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}`;
  return ref ? `${base}?ref=${encodeURIComponent(ref)}` : base;
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(String(value).replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function githubFetch(env, path, init = {}, ref = "") {
  const config = settings(env);
  const response = await fetch(contentUrl(config, path, ref), {
    ...init,
    headers: {
      ...headers(config.token),
      ...(init.headers || {}),
    },
  });
  return { response, config };
}

export async function readRepoFile(env, path) {
  const activeBranch = settings(env).branch;
  const { response, config } = await githubFetch(env, path, {}, activeBranch);

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GitHub read failed (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  return {
    text: decodeBase64(data.content),
    sha: data.sha,
    url: data.html_url,
    branch: config.branch,
  };
}

export async function listRepoDirectory(env, path) {
  const config = settings(env);
  const { response } = await githubFetch(env, path, {}, config.branch);
  if (!response.ok) {
    throw new Error(`GitHub list failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export async function writeRepoFile(env, { path, text, sha, message }) {
  const config = settings(env);
  const payload = {
    message,
    content: encodeBase64(text),
    branch: config.branch,
  };
  if (sha) payload.sha = sha;

  const { response } = await githubFetch(env, path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (response.status === 409 || response.status === 422) {
    return { conflict: true, details: await response.text() };
  }
  if (!response.ok) {
    throw new Error(`GitHub write failed (${response.status}): ${await response.text()}`);
  }
  const data = await response.json();
  return {
    conflict: false,
    sha: data.content?.sha || "",
    url: data.content?.html_url || "",
    commitSha: data.commit?.sha || "",
    commit: data.commit?.html_url || "",
  };
}

export async function readPublishRun(env, commitSha) {
  const config = settings(env);
  const workflow = String(env.PUBLIC_WORKFLOW || "publish-site.yml").trim();
  const url = new URL(
    `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/workflows/${encodeURIComponent(workflow)}/runs`,
  );
  url.searchParams.set("head_sha", commitSha);
  url.searchParams.set("event", "push");
  url.searchParams.set("per_page", "1");

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "ODaily-Writer",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub Actions status failed (${response.status}).`);
  }

  const data = await response.json();
  const run = data.workflow_runs?.[0];
  if (!run) return null;
  return {
    status: run.status || "queued",
    conclusion: run.conclusion || "",
    url: run.html_url || "",
  };
}
