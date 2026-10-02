import { state, isActive, project, byNewest } from "./state.js";
import { $, createRenderer } from "./render.js";
import { createAPI, describeError } from "./api.js";
import { createPolling } from "./polling.js";
import { bindEvents } from "./events.js";
import { bindProjectManagement } from "./projects.js";

const api = createAPI(onSessionExpired);
const view = createRenderer({
  selectProject,
  selectDeployment: (id) => selectDeployment(id),
});
const polling = createPolling({ api, view });
const { showNotice, renderControls, renderFile, renderProjects, renderLog } =
  view;
const { stopPolling, selectDeployment } = polling;

function onSessionExpired() {
  const hadSession = Boolean(state.user);
  showLogin();
  $("login-error").textContent = "세션이 만료되었습니다. 다시 로그인해 주세요";
  $("login-error").hidden = !hadSession;
}

function showLogin() {
  stopPolling();
  state.epoch += 1;
  Object.assign(state, {
    user: null,
    csrf: "",
    projects: [],
    projectId: null,
    deploymentId: null,
    deployment: null,
    file: null,
    busy: false,
    loadingDeployment: false,
    logError: "",
    limits: null,
    serverBusy: false,
  });
  $("app-view").hidden = true;
  $("boot-view").hidden = true;
  $("login-view").hidden = false;
  $("login-button").disabled = false;
  $("login-button").textContent = "로그인 →";
  $("password").value = "";
  $("artifact-file").value = "";
  $("version-input").value = "";
  $("log-output").textContent =
    "배포를 시작하거나 이력에서 항목을 선택하면 로그가 표시됩니다";
  $("notice").hidden = true;
  $("project-editor").hidden = true;
  $("project-remove-confirm").hidden = true;
  renderFile();
}

async function loadProjects() {
  const epoch = state.epoch;
  const result = await api("/api/projects");
  if (epoch !== state.epoch) return;
  state.projects = Array.isArray(result.projects) ? result.projects : [];
  state.limits = result.limits || null;
  state.serverBusy = Boolean(result.uploading);
  if (!state.projects.some((item) => String(item.id) === state.projectId))
    state.projectId = state.projects[0] ? String(state.projects[0].id) : null;
  renderProjects();
}

async function startSession() {
  const me = await api("/api/me");
  state.user = me.username;
  state.csrf = me.csrf;
  $("user-name").textContent = me.username;
  $("login-view").hidden = true;
  $("boot-view").hidden = true;
  $("app-view").hidden = false;
  await loadProjects();
  const current = project();
  const deployment =
    (current?.deployments || []).find(isActive) ||
    byNewest(current?.deployments, "startedAt")[0];
  if (deployment) await selectDeployment(String(deployment.id));
}

async function selectProject(id, force = false) {
  if ((!force && state.busy) || (!force && state.projectId === id)) return;
  stopPolling();
  state.epoch += 1;
  Object.assign(state, {
    projectId: id,
    deploymentId: null,
    deployment: null,
    file: null,
    loadingDeployment: false,
    logError: "",
  });
  $("artifact-file").value = "";
  $("artifact-select").value = "";
  $("project-editor").hidden = true;
  $("project-remove-confirm").hidden = true;
  $("version-input").value = "";
  showNotice("");
  renderFile();
  renderProjects();
  renderLog("배포를 시작하거나 이력에서 항목을 선택하면 로그가 표시됩니다");
  const epoch = state.epoch;
  try {
    await loadProjects();
  } catch (error) {
    if (epoch === state.epoch && error.status !== 401)
      showNotice(describeError(error), true);
  }
  if (epoch !== state.epoch || !state.user) return;
  const selectedProject = project();
  const deployment =
    (selectedProject?.deployments || []).find(isActive) ||
    byNewest(selectedProject?.deployments, "startedAt")[0];
  if (deployment) await selectDeployment(String(deployment.id));
}

async function action(callback) {
  if (state.busy) return;
  state.busy = true;
  renderControls();
  try {
    await callback();
  } catch (error) {
    if (error.status !== 401 && state.user)
      showNotice(describeError(error), true);
  } finally {
    state.busy = false;
    renderControls();
  }
}

bindEvents({
  api,
  view,
  polling,
  action,
  showLogin,
  startSession,
  loadProjects,
});

bindProjectManagement({ api, view, action, selectProject });

void startSession().catch((error) => {
  if (error.status === 401) return;
  if (state.user) showNotice(describeError(error), true);
  else {
    showLogin();
    $("login-error").textContent = describeError(error);
    $("login-error").hidden = false;
  }
});
