"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    user: null,
    csrf: "",
    projects: [],
    projectId: null,
    deploymentId: null,
    deployment: null,
    file: null,
    busy: false,
    timer: null,
    pollAbort: null,
    epoch: 0,
    loadingDeployment: false,
    logError: "",
  };
  const activeStatuses = new Set([
    "running",
    "queued",
    "pending",
    "starting",
    "cancelling",
    "canceling",
  ]);
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
  const isActive = (deployment) =>
    Boolean(deployment && activeStatuses.has(deployment.status));
  const project = () =>
    state.projects.find((item) => String(item.id) === state.projectId);
  const statusDetails = (status) =>
    statusMap[status] || [String(status || "알 수 없음"), "neutral"];
  const byNewest = (items, key) =>
    [...(items || [])].sort(
      (a, b) => (Date.parse(b[key]) || 0) - (Date.parse(a[key]) || 0),
    );
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

  function showNotice(message, error = false) {
    $("notice-text").textContent = message;
    $("notice").className = `notice${error ? " error" : ""}`;
    $("notice").hidden = !message;
  }

  function stopPolling() {
    if (state.timer !== null) window.clearTimeout(state.timer);
    state.timer = null;
    if (state.pollAbort) state.pollAbort.abort();
    state.pollAbort = null;
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
    renderFile();
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== "GET")
      headers.set("X-CSRF-Token", state.csrf);
    if (options.json !== undefined)
      headers.set("Content-Type", "application/json");
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers,
      body:
        options.json !== undefined
          ? JSON.stringify(options.json)
          : options.body,
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      /* Empty success responses are allowed. */
    }
    if (!response.ok) {
      if (response.status === 401 && path !== "/api/login") {
        const hadSession = Boolean(state.user);
        showLogin();
        $("login-error").textContent =
          "세션이 만료되었습니다. 다시 로그인해 주세요";
        $("login-error").hidden = !hadSession;
      }
      const error = new Error(
        data?.error || `요청을 완료하지 못했습니다 (${response.status})`,
      );
      error.status = response.status;
      throw error;
    }
    return data || {};
  }

  function describeError(error) {
    return error instanceof TypeError
      ? "서버에 연결할 수 없습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요"
      : error.message || "요청을 완료하지 못했습니다";
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

  async function loadProjects() {
    const epoch = state.epoch;
    const result = await api("/api/projects");
    if (epoch !== state.epoch) return;
    state.projects = Array.isArray(result.projects) ? result.projects : [];
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

  async function selectProject(id) {
    if (state.busy || state.projectId === id) return;
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

  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if ($("login-button").disabled) return;
    $("login-error").hidden = true;
    $("login-button").disabled = true;
    $("login-button").textContent = "로그인 중…";
    try {
      await api("/api/login", {
        method: "POST",
        json: {
          username: $("username").value.trim(),
          password: $("password").value,
        },
      });
      await startSession();
    } catch (error) {
      if (state.user) showNotice(describeError(error), true);
      else {
        $("login-error").textContent =
          error.status === 401
            ? "사용자 이름 또는 비밀번호를 확인해 주세요"
            : describeError(error);
        $("login-error").hidden = false;
      }
    } finally {
      $("password").value = "";
      $("login-button").disabled = false;
      $("login-button").textContent = "로그인 →";
    }
  });

  $("logout-button").addEventListener("click", () =>
    action(async () => {
      await api("/api/logout", { method: "POST" });
      showLogin();
    }),
  );
  $("notice-dismiss").addEventListener("click", () => showNotice(""));
  $("artifact-select").addEventListener("change", renderControls);
  $("version-input").addEventListener("input", renderControls);
  $("artifact-file").addEventListener("change", (event) => {
    state.file = event.target.files[0] || null;
    renderFile();
  });
  $("drop-zone").addEventListener("click", (event) => {
    if ($("artifact-file").disabled) event.preventDefault();
  });
  for (const name of ["dragenter", "dragover"])
    $("drop-zone").addEventListener(name, (event) => {
      event.preventDefault();
      if (!$("artifact-file").disabled)
        $("drop-zone").classList.add("drag-over");
    });
  for (const name of ["dragleave", "drop"])
    $("drop-zone").addEventListener(name, (event) => {
      event.preventDefault();
      $("drop-zone").classList.remove("drag-over");
    });
  $("drop-zone").addEventListener("drop", (event) => {
    if ($("artifact-file").disabled) return;
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    if (files.length > 1) {
      showNotice("한 번에 파일 하나씩 업로드해 주세요", true);
      return;
    }
    state.file = files[0];
    $("artifact-file").value = "";
    renderFile();
  });

  $("upload-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if ($("upload-button").disabled || !state.file || !project()) return;
    void action(async () => {
      const file = state.file;
      $("upload-button").textContent = "업로드 중…";
      try {
        const result = await api(
          `/api/projects/${encodeURIComponent(state.projectId)}/artifacts`,
          {
            method: "POST",
            body: file,
            headers: {
              "Content-Type": "application/octet-stream",
              "X-Artifact-Name": encodeURIComponent(file.name),
            },
          },
        );
        state.file = null;
        $("artifact-file").value = "";
        renderFile();
        await loadProjects();
        const uploaded = result.artifact || result;
        renderProject(
          uploaded.id ||
            byNewest(project()?.artifacts, "createdAt").find(
              (item) => item.name === file.name,
            )?.id,
        );
        showNotice(
          `‘${file.name}’ 업로드가 완료됐어요. 버전을 입력하고 배포를 시작하세요`,
        );
      } finally {
        $("upload-button").textContent = "업로드";
      }
    });
  });

  $("deploy-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if ($("deploy-button").disabled) return;
    void action(async () => {
      $("deploy-button").textContent = "배포 시작 중…";
      try {
        const result = await api(
          `/api/projects/${encodeURIComponent(state.projectId)}/deploy`,
          {
            method: "POST",
            json: {
              artifactId: $("artifact-select").value,
              version: $("version-input").value.trim(),
            },
          },
        );
        const deployment = result.deployment || result;
        if (!deployment.id)
          throw new Error(
            "배포 요청은 처리됐지만 실행 ID를 확인하지 못했습니다. 새로고침으로 상태를 확인해 주세요",
          );
        stopPolling();
        state.epoch += 1;
        state.deploymentId = String(deployment.id);
        state.loadingDeployment = true;
        updateDeployment(deployment);
        renderLog("실행 로그를 불러오는 중…");
        showNotice(
          `‘${deployment.version || $("version-input").value.trim()}’ 배포를 시작했어요`,
        );
        await fetchDeployment(true);
      } finally {
        $("deploy-button").textContent = "↗ 배포 시작";
      }
    });
  });

  $("cancel-button").addEventListener("click", () => {
    if (!isActive(state.deployment) || $("cancel-button").disabled) return;
    void action(async () => {
      await api(
        `/api/projects/${encodeURIComponent(state.projectId)}/deployments/${encodeURIComponent(state.deploymentId)}/cancel`,
        { method: "POST" },
      );
      showNotice("실행 취소를 요청했어요. 종료 상태를 확인하고 있습니다");
      stopPolling();
      await fetchDeployment(true);
    });
  });

  $("refresh-button").addEventListener("click", () =>
    action(async () => {
      await loadProjects();
      if (state.deploymentId) {
        stopPolling();
        await fetchDeployment(true);
      } else {
        const current = project();
        const deployment =
          (current?.deployments || []).find(isActive) ||
          byNewest(current?.deployments, "startedAt")[0];
        if (deployment) {
          state.deploymentId = String(deployment.id);
          state.deployment = deployment;
          state.loadingDeployment = true;
          await fetchDeployment(true);
        }
      }
      if (!state.logError) showNotice("최신 상태를 불러왔어요");
    }),
  );

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPolling();
    else if (isActive(state.deployment)) schedulePoll();
    renderLog();
  });
  window.addEventListener("pagehide", stopPolling);
  void startSession().catch((error) => {
    if (error.status === 401) return;
    if (state.user) showNotice(describeError(error), true);
    else {
      showLogin();
      $("login-error").textContent = describeError(error);
      $("login-error").hidden = false;
    }
  });
})();
