import { state, isActive, project, byNewest } from "./state.js";

export const $ = (id) => document.getElementById(id);

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const statusMap = {
  running: ["실행 중", "running"],
  queued: ["대기 중", "running"],
  pending: ["대기 중", "running"],
  starting: ["시작 중", "running"],
  cancelling: ["취소 중", "running"],
  canceling: ["취소 중", "running"],
  success: ["완료", "success"],
  succeeded: ["완료", "success"],
  completed: ["완료", "success"],
  failed: ["실패", "failed"],
  error: ["실패", "failed"],
  timed_out: ["시간 초과", "failed"],
  interrupted: ["중단됨", "cancelled"],
  cancelled: ["취소됨", "cancelled"],
  canceled: ["취소됨", "cancelled"],
};
const statusDetails = (status) =>
  statusMap[status] || [String(status || "알 수 없음"), "neutral"];
const formatDate = (value) => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? dateFormatter.format(date)
    : "시간 정보 없음";
};
const formatSize = (value) => {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) return "";
  return size < 1024
    ? `${size} B`
    : size < 1048576
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1048576).toFixed(1)} MB`;
};
const make = (tag, className, value) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
};

export function createRenderer({ selectProject, selectDeployment }) {
  function showNotice(message, error = false) {
    $("notice-text").textContent = message;
    $("notice").className = `notice${error ? " error" : ""}`;
    $("notice").hidden = !message;
  }

  function renderControls() {
    const selectedProject = project();
    const running = Boolean(
      selectedProject &&
      (selectedProject.running ||
        (selectedProject.deployments || []).some(isActive)),
    );
    const anyRunning = state.projects.some(
      (item) => item.running || (item.deployments || []).some(isActive),
    );
    $("refresh-button").disabled = state.busy;
    $("logout-button").disabled = state.busy;
    $("artifact-file").disabled = state.busy || !selectedProject || running;
    $("drop-zone").classList.toggle(
      "disabled",
      state.busy || !selectedProject || running,
    );
    $("upload-button").disabled =
      state.busy || !selectedProject || !state.file || running;
    $("artifact-select").disabled =
      state.busy ||
      !selectedProject ||
      !(selectedProject.artifacts || []).length;
    $("version-input").disabled = state.busy || !selectedProject || anyRunning;
    $("deploy-button").disabled =
      state.busy ||
      !selectedProject ||
      anyRunning ||
      !$("artifact-select").value ||
      !$("version-input").value.trim();
    $("cancel-button").disabled =
      state.busy ||
      state.loadingDeployment ||
      !isActive(state.deployment) ||
      ["cancelling", "canceling"].includes(state.deployment?.status);
    $("deploy-hint").textContent = running
      ? "현재 배포가 끝나면 다음 배포를 시작할 수 있어요"
      : anyRunning
        ? "다른 프로젝트의 배포가 끝나면 시작할 수 있어요"
        : "파일과 버전을 확인한 뒤 실행하세요";
    document
      .querySelectorAll(".project-nav, .history-entry")
      .forEach((button) => {
        button.disabled = state.busy;
      });
  }

  function renderFile() {
    $("file-label").textContent = state.file
      ? state.file.name
      : "파일을 끌어놓거나 선택하세요";
    $("file-detail").textContent = state.file
      ? formatSize(state.file.size)
      : "프로젝트에서 실행할 빌드 결과물";
    $("upload-hint").textContent = state.file
      ? "선택한 파일을 서버에 업로드할 준비가 됐어요"
      : "파일 선택 후 서버에 업로드합니다";
    renderControls();
  }

  function renderProjects() {
    $("project-count").textContent = state.projects.length;
    $("project-list").replaceChildren();
    for (const item of state.projects) {
      const button = make(
        "button",
        `project-nav${String(item.id) === state.projectId ? " active" : ""}`,
      );
      button.type = "button";
      button.append(make("span", "", item.name || item.id));
      button.setAttribute(
        "aria-current",
        String(item.id) === state.projectId ? "page" : "false",
      );
      button.addEventListener("click", () => selectProject(String(item.id)));
      $("project-list").append(button);
    }
    renderProject();
  }

  function renderProject(preferredArtifactId) {
    const selectedProject = project();
    $("empty-projects").hidden = Boolean(selectedProject);
    $("project-content").hidden = !selectedProject;
    $("project-title").textContent = selectedProject?.name || "프로젝트";
    $("breadcrumb").textContent = selectedProject?.name || "프로젝트";
    $("project-description").textContent = selectedProject
      ? "배포 파일을 올리고 새 버전을 실행하세요"
      : "등록된 프로젝트를 여기에서 관리할 수 있어요";
    if (!selectedProject) {
      renderControls();
      return;
    }
    const artifacts = byNewest(selectedProject.artifacts, "createdAt");
    const deployments = byNewest(selectedProject.deployments, "startedAt");
    const latest = deployments[0];
    const running = selectedProject.running || deployments.some(isActive);
    const [latestStatus, latestClass] = latest
      ? statusDetails(latest.status)
      : ["대기 중", "neutral"];
    $("project-status").textContent = running
      ? "실행 중"
      : latest
        ? latestStatus
        : "배포 대기";
    $("project-status-dot").className =
      `status-dot ${running ? "running" : latestClass}`;
    $("artifact-count").textContent = artifacts.length;
    $("latest-version").textContent = latest?.version || "아직 없음";
    $("latest-time").textContent = latest ? formatDate(latest.startedAt) : "";
    const previousArtifactId =
      preferredArtifactId ?? $("artifact-select").value;
    const select = $("artifact-select");
    select.replaceChildren();
    if (!artifacts.length) {
      const option = make("option", "", "파일을 먼저 업로드하세요");
      option.value = "";
      select.append(option);
    }
    for (const artifact of artifacts) {
      const option = make(
        "option",
        "",
        `${artifact.name} · ${formatSize(artifact.size)}`,
      );
      option.value = String(artifact.id);
      select.append(option);
    }
    if (
      artifacts.some((item) => String(item.id) === String(previousArtifactId))
    )
      select.value = String(previousArtifactId);
    renderHistory();
    renderControls();
  }

  function renderHistory() {
    const selectedProject = project();
    const deployments = byNewest(selectedProject?.deployments, "startedAt");
    $("history-count").textContent = deployments.length;
    $("history-list").replaceChildren();
    if (!deployments.length) {
      const empty = make("div", "empty-state");
      empty.append(
        make("div", "empty-icon", "◷"),
        make("h2", "", "첫 배포를 기다리고 있어요"),
        make("p", "", "배포가 시작되면 이곳에 기록됩니다"),
      );
      $("history-list").append(empty);
      return;
    }
    for (const deployment of deployments) {
      const button = make(
        "button",
        `history-entry${String(deployment.id) === state.deploymentId ? " active" : ""}`,
      );
      button.type = "button";
      button.setAttribute(
        "aria-pressed",
        String(deployment.id) === state.deploymentId ? "true" : "false",
      );
      const head = make("div", "history-head");
      const [text, kind] = statusDetails(deployment.status);
      head.append(
        make("span", "history-version", deployment.version || "버전 없음"),
        make("span", `badge ${kind}`, text),
      );
      const artifact = (selectedProject.artifacts || []).find(
        (item) => String(item.id) === String(deployment.artifactId),
      );
      button.append(
        head,
        make("span", "history-date", formatDate(deployment.startedAt)),
        make("span", "history-artifact", artifact?.name || "배포 파일"),
      );
      button.addEventListener("click", () =>
        selectDeployment(String(deployment.id)),
      );
      $("history-list").append(button);
    }
  }

  function renderLog(log, forceScroll = false) {
    const deployment = state.deployment;
    const [text, kind] = deployment
      ? statusDetails(deployment.status)
      : ["선택된 배포 없음", "neutral"];
    $("log-status").textContent = text;
    $("log-status").className = `badge ${kind}`;
    $("log-version").textContent = deployment?.version
      ? `${deployment.version} · deployment.log`
      : "deployment.log";
    $("log-updating").hidden = !isActive(deployment) || document.hidden;
    $("cancel-button").hidden = !isActive(deployment);
    const terminal = $("log-output");
    if (log !== undefined) {
      terminal.textContent =
        typeof log === "string"
          ? log ||
            (isActive(deployment)
              ? "실행 로그를 기다리고 있습니다…"
              : "기록된 로그가 없습니다")
          : Array.isArray(log)
            ? log.join("\n")
            : "기록된 로그가 없습니다";
      if (forceScroll || $("follow-log").checked)
        terminal.scrollTop = terminal.scrollHeight;
    }
    const exit = deployment?.exitCode;
    $("log-meta").textContent = state.loadingDeployment
      ? "실행 로그를 불러오는 중…"
      : deployment
        ? `${deployment.finishedAt ? `종료 ${formatDate(deployment.finishedAt)}` : `시작 ${formatDate(deployment.startedAt)}`}${exit !== null && exit !== undefined ? ` · 종료 코드 ${exit}` : ""}`
        : "실행 중일 때만 2초 간격으로 갱신됩니다";
    renderControls();
  }

  return {
    showNotice,
    renderControls,
    renderFile,
    renderProjects,
    renderProject,
    renderHistory,
    renderLog,
  };
}
