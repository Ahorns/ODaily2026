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
  toast: document.querySelector("#toast"),
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

function notify(message, kind = "success") {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.kind = kind;
  elements.toast.dataset.show = "true";
  state.toastTimer = setTimeout(() => { elements.toast.dataset.show = "false"; }, 4200);
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
  if (!state.projects.length) throw new Error("No projects were found. Check projects.yml.");
}

async function loadDates() {
  const data = await request("/api/dates");
  state.dates = data.dates || [];
  renderHistory();
}

async function loadDate(date, { quiet = false } = {}) {
  if (!date) return;
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
    elements.saveTitle.textContent = "Synced to GitHub";
    elements.saveDetail.textContent = "The galaxy site is rebuilding and usually updates within a minute or two.";
    setCloud("ready", "Saved");
    notify(data.message || "Entry saved.", "success");
    await loadDates();
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

boot();
