import { state, isActive, project } from "./state.js";
import { $ } from "./render.js";
import { describeError } from "./api.js";

export function createPolling({ api, view }) {
  const { showNotice, renderProject, renderHistory, renderLog } = view;
  function stopPolling() {
    if (state.timer !== null) window.clearTimeout(state.timer);
    state.timer = null;
    if (state.pollAbort) state.pollAbort.abort();
    state.pollAbort = null;
  }

  function updateDeployment(deployment) {
    const selectedProject = project();
    if (!selectedProject) return;
    const index = (selectedProject.deployments || []).findIndex(
      (item) => String(item.id) === String(deployment.id),
    );
    if (!selectedProject.deployments) selectedProject.deployments = [];
    if (index < 0) selectedProject.deployments.unshift(deployment);
    else selectedProject.deployments[index] = deployment;
    const running = selectedProject.deployments.find(isActive);
    selectedProject.running = running ? running.id : null;
    state.deployment = deployment;
    renderProject();
  }

  function schedulePoll() {
    if (state.timer !== null) window.clearTimeout(state.timer);
    state.timer = null;
    if (
      !state.user ||
      document.hidden ||
      !isActive(state.deployment) ||
      state.loadingDeployment
    )
      return;
    state.timer = window.setTimeout(() => {
      state.timer = null;
      void fetchDeployment(false);
    }, 2000);
  }

  async function fetchDeployment(initial = false) {
    if (!state.user || !state.projectId || !state.deploymentId) return;
    if (!initial && (document.hidden || !isActive(state.deployment))) return;
    const epoch = state.epoch;
    const projectId = state.projectId;
    const deploymentId = state.deploymentId;
    const controller = new AbortController();
    state.pollAbort = controller;
    try {
      const result = await api(
        `/api/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}`,
        { signal: controller.signal },
      );
      if (
        epoch !== state.epoch ||
        projectId !== state.projectId ||
        deploymentId !== state.deploymentId
      )
        return;
      if (!result.deployment)
        throw new Error("배포 정보를 불러오지 못했습니다");
      updateDeployment(result.deployment);
      state.loadingDeployment = false;
      if (state.logError) {
        showNotice("");
        state.logError = "";
      }
      renderLog(result.log, initial);
    } catch (error) {
      if (epoch !== state.epoch) return;
      if (error.name === "AbortError") {
        state.loadingDeployment = false;
        renderLog();
        return;
      }
      state.loadingDeployment = false;
      if (error.status !== 401) {
        state.logError = describeError(error);
        showNotice(
          `${state.logError}${isActive(state.deployment) ? " 실행 상태를 다시 확인하고 있습니다" : ""}`,
          true,
        );
        if (initial)
          $("log-output").textContent =
            "로그를 불러오지 못했습니다. 새로고침으로 다시 시도해 주세요";
        renderLog();
      }
    } finally {
      if (state.pollAbort === controller) state.pollAbort = null;
      if (epoch === state.epoch) schedulePoll();
    }
  }

  async function selectDeployment(id) {
    if (state.busy) return;
    stopPolling();
    state.epoch += 1;
    state.deploymentId = id;
    state.deployment =
      (project()?.deployments || []).find((item) => String(item.id) === id) ||
      null;
    state.loadingDeployment = true;
    state.logError = "";
    renderHistory();
    renderLog("실행 로그를 불러오는 중…");
    await fetchDeployment(true);
  }

  return {
    stopPolling,
    schedulePoll,
    fetchDeployment,
    selectDeployment,
    updateDeployment,
  };
}
