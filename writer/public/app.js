const elements = {
  form: document.querySelector("#entryForm"),
  date: document.querySelector("#entryDate"),
  milestone: document.querySelector("#milestone"),
  sessions: document.querySelector("#sessionList"),
  sessionTemplate: document.querySelector("#sessionTemplate"),
  history: document.querySelector("#historyList"),
  hours: document.querySelector("#hoursTotal"),
  save: document.querySelector("#saveButton"),
  reload: document.querySelector("#reloadButton"),
  today: document.querySelector("#todayButton"),
  addSession: document.querySelector("#addSession"),
  refreshDates: document.querySelector("#refreshDates"),
  cloud: document.querySelector("#cloudState"),
  cloudText: document.querySelector("#cloudStateText"),
  saveTitle: document.querySelector("#saveTitle"),
  saveDetail: document.querySelector("#saveDetail"),
  publicLink: document.querySelector("#publicEntryLink"),
  toast: document.querySelector("#toast"),
  toggleProjects: document.querySelector("#toggleProjects"),
  projectManagerBody: document.querySelector("#projectManagerBody"),
  projectList: document.querySelector("#projectList"),
  projectForm: document.querySelector("#projectForm"),
  projectOriginalSlug: document.querySelector("#projectOriginalSlug"),
  projectName: document.querySelector("#projectName"),
  projectSlug: document.querySelector("#projectSlug"),
  projectGroup: document.querySelector("#projectGroup"),
  newGroupRow: document.querySelector("#newGroupRow"),
  newGroupName: document.querySelector("#newGroupName"),
  projectCategory: document.querySelector("#projectCategory"),
  projectColor: document.querySelector("#projectColor"),
  projectBlurb: document.querySelector("#projectBlurb"),
  projectStatus: document.querySelector("#projectStatus"),
  cancelProject: document.querySelector("#cancelProject"),
  saveProject: document.querySelector("#saveProject"),
  fields: {
    start: document.querySelector("#startText"),
    did: document.querySelector("#didText"),
    well: document.querySelector("#wellText"),
    learned: document.querySelector("#learnedText"),
    idea: document.querySelector("#ideaText"),
    other: document.querySelector("#otherText"),
  },
};

const state = {
  projects: [],
  dates: [],
  sha: "",
  exists: false,
  hydrating: false,
  draftTimer: null,
  toastTimer: null,
  publishSequence: 0,
  projectRegistry: { groups: {}, projects: {} },
  projectsSha: "",
};

function localToday() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function draftKey(date) {
  return `odaily-draft:${date}`;
}

function setCloud(status, text) {
  elements.cloud.dataset.state = status;
  elements.cloudText.textContent = text;
}

function setPublicLink(url = "") {
  let safeUrl = "";
  try {
    const parsed = new URL(url);
    if (parsed.origin === "https://odaily2026.pages.dev") safeUrl = parsed.href;
  } catch {
    safeUrl = "";
  }
  elements.publicLink.hidden = !safeUrl;
  if (safeUrl) elements.publicLink.href = safeUrl;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function monitorPublication({ commitSha, publicUrl }, sequence) {
  if (!commitSha) {
    elements.saveDetail.textContent = "The galaxy is updating. Check the public site in a minute.";
    setCloud("ready", "Saved");
    return;
  }

  let failedChecks = 0;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await delay(attempt === 0 ? 2500 : 5000);
    if (sequence !== state.publishSequence) return;
    try {
      const result = await request(`/api/publish-status?commit=${encodeURIComponent(commitSha)}`);
      failedChecks = 0;
      if (result.state === "success") {
        elements.saveTitle.textContent = "3/3 · Galaxy updated";
        elements.saveDetail.textContent = "Your published entry is now live.";
        setPublicLink(publicUrl);
        setCloud("ready", "Galaxy updated");
        notify("Galaxy updated. Your entry is live.", "success");
        return;
      }
      if (result.state === "failure") {
        elements.saveTitle.textContent = "Saved to GitHub";
        elements.saveDetail.textContent = "The galaxy build failed, but your entry is safe in GitHub.";
        setCloud("error", "Build failed");
        notify("The public-site build needs attention.", "error");
        return;
      }
      elements.saveTitle.textContent = "1/3 · Saved to GitHub";
      elements.saveDetail.textContent = "2/3 · Building galaxy…";
      setCloud("loading", "Building galaxy");
    } catch {
      failedChecks += 1;
      if (failedChecks >= 3) break;
    }
  }

  if (sequence !== state.publishSequence) return;
  elements.saveTitle.textContent = "Saved to GitHub";
  elements.saveDetail.textContent = "The galaxy is still updating. You can keep writing and check it shortly.";
  setCloud("ready", "Saved");
}

function notify(message, kind = "success") {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.kind = kind;
  elements.toast.dataset.show = "true";
  state.toastTimer = setTimeout(() => { elements.toast.dataset.show = "false"; }, 4200);
}

function cloneRegistry() {
  return JSON.parse(JSON.stringify(state.projectRegistry));
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function renderProjectGroupOptions(selected = "") {
  elements.projectGroup.replaceChildren();
  for (const [key, group] of Object.entries(state.projectRegistry.groups || {})) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = group.name || key;
    option.selected = key === selected;
    elements.projectGroup.append(option);
  }
  const newOption = document.createElement("option");
  newOption.value = "__new__";
  newOption.textContent = "+ New group";
  newOption.selected = selected === "__new__";
  elements.projectGroup.append(newOption);
  setNewGroupVisibility();
}

function setNewGroupVisibility() {
  const isNew = elements.projectGroup.value === "__new__";
  elements.newGroupRow.hidden = !isNew;
  elements.newGroupName.required = isNew;
}

function renderProjectManager() {
  elements.projectList.replaceChildren();
  const entries = Object.entries(state.projectRegistry.projects || {});
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No projects yet.";
    elements.projectList.append(empty);
    return;
  }
  for (const [slug, project] of entries) {
    const row = document.createElement("div");
    row.className = "project-row";
    const swatch = document.createElement("span");
    swatch.className = "project-swatch";
    swatch.style.background = project.color || "#7fd8f7";
    const details = document.createElement("span");
    details.className = "project-row-details";
    const name = document.createElement("strong");
    name.textContent = project.name || slug;
    const meta = document.createElement("small");
    meta.textContent = (project.status === "archived" ? "Archived · " : "") + (project.category || "other") + " · " + slug;
    details.append(name, meta);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "icon-button project-edit";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => editProject(slug));
    row.append(swatch, details, edit);
    elements.projectList.append(row);
  }
}

function resetProjectForm() {
  elements.projectOriginalSlug.value = "";
  elements.projectName.value = "";
  elements.projectSlug.value = "";
  elements.projectSlug.disabled = false;
  renderProjectGroupOptions(Object.keys(state.projectRegistry.groups || {})[0] || "");
  elements.newGroupName.value = "";
  elements.projectCategory.value = "coding";
  elements.projectColor.value = "#7fd8f7";
  elements.projectBlurb.value = "";
  elements.projectStatus.value = "active";
}

function editProject(slug) {
  const project = state.projectRegistry.projects?.[slug];
  if (!project) return;
  elements.projectOriginalSlug.value = slug;
  elements.projectName.value = project.name || "";
  elements.projectSlug.value = slug;
  elements.projectSlug.disabled = true;
  renderProjectGroupOptions(project.group || "");
  elements.newGroupName.value = "";
  elements.projectCategory.value = project.category || "other";
  elements.projectColor.value = project.color || "#7fd8f7";
  elements.projectBlurb.value = project.blurb || "";
  elements.projectStatus.value = project.status || "active";
  elements.projectName.focus();
}

async function saveProject(event) {
  event.preventDefault();
  const registry = cloneRegistry();
  const originalSlug = elements.projectOriginalSlug.value.trim();
  const name = elements.projectName.value.trim();
  const slug = (elements.projectSlug.value.trim() || slugify(name) || "project-" + Date.now().toString(36)).toLowerCase();
  let group = elements.projectGroup.value;
  if (group === "__new__") {
    const groupName = elements.newGroupName.value.trim();
    group = slugify(groupName);
    if (!group || !groupName) {
      notify("Enter a name for the new group.", "error");
      return;
    }
    registry.groups[group] ||= { name: groupName, blurb: "" };
  }
  if (!name || !slug) {
    notify("Enter a project name.", "error");
    return;
  }
  if (!originalSlug && registry.projects[slug]) {
    notify("That project key already exists.", "error");
    return;
  }
  registry.projects[slug] = {
    ...(registry.projects[originalSlug] || {}),
    name,
    group,
    category: elements.projectCategory.value,
    color: elements.projectColor.value,
    status: elements.projectStatus.value,
    blurb: elements.projectBlurb.value.trim(),
  };
  if (originalSlug && originalSlug !== slug) delete registry.projects[originalSlug];

  elements.saveProject.disabled = true;
  try {
    const data = await request("/api/projects", {
      method: "PUT",
      body: JSON.stringify({ sha: state.projectsSha, registry }),
    });
    state.projectsSha = data.sha;
    state.projectRegistry = registry;
    await loadProjects();
    refreshSessionProjects();
    renderProjectManager();
    resetProjectForm();
    notify("Project saved. The galaxy is rebuilding.", "success");
  } catch (error) {
    notify(error.message, "error");
  } finally {
    elements.saveProject.disabled = false;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
  });
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function projectOptions(select, selected = "") {
  select.replaceChildren();
  const groups = new Map();
  for (const project of state.projects) {
    if (!groups.has(project.group)) groups.set(project.group, []);
    groups.get(project.group).push(project);
  }
  for (const [group, projects] of groups) {
    const optionGroup = document.createElement("optgroup");
    optionGroup.label = group;
    for (const project of projects) {
      const option = document.createElement("option");
      option.value = project.slug;
      option.textContent = project.name;
      option.selected = project.slug === selected;
      optionGroup.append(option);
    }
    select.append(optionGroup);
  }
}

function refreshSessionProjects() {
  for (const row of elements.sessions.querySelectorAll(".session-row")) {
    const select = row.querySelector("select");
    const selected = select.value;
    projectOptions(select, selected);
  }
}

function addSession(session = {}) {
  const row = elements.sessionTemplate.content.firstElementChild.cloneNode(true);
  const select = row.querySelector("select");
  const hours = row.querySelector('input[type="number"]');
  const note = row.querySelector('input[type="text"]');
  projectOptions(select, session.project || state.projects[0]?.slug || "");
  hours.value = Number.isFinite(Number(session.hours)) ? String(session.hours) : "0";
  note.value = session.note || "";
  row.dataset.category = session.category || "";
  row.querySelector(".remove-session").addEventListener("click", () => {
    row.remove();
    if (!elements.sessions.children.length) addSession();
    changed();
  });
  elements.sessions.append(row);
  updateHours();
}

function updateHours() {
  const total = [...elements.sessions.querySelectorAll('input[type="number"]')]
    .reduce((sum, input) => sum + (Number(input.value) || 0), 0);
  elements.hours.textContent = Number(total.toFixed(2)).toString();
}

function model() {
  return {
    date: elements.date.value,
    milestone: elements.milestone.checked,
    sha: state.sha,
    sections: Object.fromEntries(
      Object.entries(elements.fields).map(([key, field]) => [key, field.value]),
    ),
    sessions: [...elements.sessions.querySelectorAll(".session-row")].map((row) => ({
      project: row.querySelector("select").value,
      hours: Number(row.querySelector('input[type="number"]').value) || 0,
      note: row.querySelector('input[type="text"]').value,
      category: row.dataset.category || "",
    })),
  };
}

function blankEntry(date) {
  return {
    date,
    milestone: false,
    sections: { start: "", did: "", well: "", learned: "", idea: "", other: "" },
    sessions: [{ project: state.projects[0]?.slug || "other", hours: 0, note: "" }],
  };
}

function fill(entry) {
  state.hydrating = true;
  elements.date.value = entry.date;
  elements.milestone.checked = Boolean(entry.milestone);
  for (const [key, field] of Object.entries(elements.fields)) field.value = entry.sections?.[key] || "";
  elements.sessions.replaceChildren();
  const sessions = entry.sessions?.length ? entry.sessions : blankEntry(entry.date).sessions;
  sessions.forEach(addSession);
  updateHours();
  state.hydrating = false;
}

function saveDraft() {
  if (state.hydrating || !elements.date.value) return;
  const draft = { ...model(), savedAt: new Date().toISOString() };
  localStorage.setItem(draftKey(elements.date.value), JSON.stringify(draft));
  elements.saveTitle.textContent = "Draft saved on this device";
  elements.saveDetail.textContent = `Last saved locally: ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function changed() {
  if (state.hydrating) return;
  state.publishSequence += 1;
  updateHours();
  clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(saveDraft, 450);
}

function restoreDraft(date) {
  const raw = localStorage.getItem(draftKey(date));
  if (!raw) return false;
  try {
    const draft = JSON.parse(raw);
    if (draft.sha !== state.sha) return false;
    fill(draft);
    const when = new Date(draft.savedAt).toLocaleString();
    elements.saveTitle.textContent = "Local draft restored";
    elements.saveDetail.textContent = `Saved locally: ${when}`;
    notify("An unpublished local draft was restored.", "info");
    return true;
  } catch {
    localStorage.removeItem(draftKey(date));
    return false;
  }
}

function renderHistory() {
  elements.history.replaceChildren();
  if (!state.dates.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No entries yet.";
    elements.history.append(empty);
    return;
  }
  for (const date of state.dates.slice(0, 18)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-date";
    button.textContent = date;
    if (date === elements.date.value) button.setAttribute("aria-current", "date");
    button.addEventListener("click", () => loadDate(date));
    elements.history.append(button);
  }
}

async function loadProjects() {
  const data = await request("/api/projects");
  state.projects = data.projects || [];
  state.projectRegistry = data.registry || { groups: {}, projects: {} };
  state.projectsSha = data.sha || "";
  if (!state.projects.length) throw new Error("No projects were found. Check projects.yml.");
  renderProjectGroupOptions(Object.keys(state.projectRegistry.groups || {})[0] || "");
  renderProjectManager();
  refreshSessionProjects();
}

async function loadDates() {
  const data = await request("/api/dates");
  state.dates = data.dates || [];
  renderHistory();
}

async function loadDate(date, { quiet = false } = {}) {
  if (!date) return;
  state.publishSequence += 1;
  setPublicLink();
  setCloud("loading", "Loading");
  state.sha = "";
  state.exists = false;
  try {
    const data = await request(`/api/entry?date=${encodeURIComponent(date)}`);
    state.sha = data.sha;
    state.exists = true;
    fill(data.entry);
    if (!restoreDraft(date)) {
      elements.saveTitle.textContent = "Editing a published entry";
      elements.saveDetail.textContent = "Publishing will create a new GitHub revision.";
    }
    setCloud("ready", "Cloud connected");
  } catch (error) {
    if (error.status === 404) {
      fill(blankEntry(date));
      restoreDraft(date);
      elements.saveTitle.textContent = "No entry for this date yet";
      elements.saveDetail.textContent = "Complete any section, then select Save & publish.";
      setCloud("ready", "Cloud connected");
    } else {
      fill(blankEntry(date));
      setCloud("error", "Connection failed");
      if (!quiet) notify(error.message, "error");
    }
  }
  renderHistory();
}

async function saveEntry(event) {
  event.preventDefault();
  clearTimeout(state.draftTimer);
  elements.save.disabled = true;
  elements.save.setAttribute("aria-busy", "true");
  setCloud("loading", "Saving");
  try {
    const data = await request("/api/entry", { method: "PUT", body: JSON.stringify(model()) });
    state.sha = data.sha;
    state.exists = true;
    localStorage.removeItem(draftKey(elements.date.value));
    const publishSequence = ++state.publishSequence;
    setPublicLink();
    elements.saveTitle.textContent = "1/3 · Saved to GitHub";
    elements.saveDetail.textContent = "2/3 · Waiting for the galaxy build…";
    setCloud("loading", "Building galaxy");
    notify("Saved to GitHub. The galaxy build is starting.", "success");
    await loadDates();
    void monitorPublication(data, publishSequence);
  } catch (error) {
    setCloud("error", "Save failed");
    notify(error.message, "error");
    if (error.status === 409) elements.saveDetail.textContent = "Select Reload, review the latest entry, and then save again.";
  } finally {
    elements.save.disabled = false;
    elements.save.removeAttribute("aria-busy");
  }
}

async function boot() {
  elements.date.value = localToday();
  try {
    await Promise.all([loadProjects(), loadDates()]);
    await loadDate(elements.date.value, { quiet: true });
  } catch (error) {
    setCloud("error", "Login or setup required");
    notify(error.message, "error");
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}

elements.form.addEventListener("input", changed);
elements.form.addEventListener("change", changed);
elements.form.addEventListener("submit", saveEntry);
elements.date.addEventListener("change", () => loadDate(elements.date.value));
elements.today.addEventListener("click", () => loadDate(localToday()));
elements.addSession.addEventListener("click", () => { addSession(); changed(); });
elements.reload.addEventListener("click", () => loadDate(elements.date.value));
elements.refreshDates.addEventListener("click", loadDates);
elements.toggleProjects.addEventListener("click", () => {
  const open = elements.projectManagerBody.hidden;
  elements.projectManagerBody.hidden = !open;
  elements.toggleProjects.setAttribute("aria-expanded", String(open));
  elements.toggleProjects.textContent = open ? "−" : "+";
  if (open) resetProjectForm();
});
elements.projectGroup.addEventListener("change", setNewGroupVisibility);
elements.projectForm.addEventListener("submit", saveProject);
elements.cancelProject.addEventListener("click", resetProjectForm);

boot();
