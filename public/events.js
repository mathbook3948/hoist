import { state, isActive, project, byNewest } from "./state.js";
import { $ } from "./render.js";
import { describeError } from "./api.js";

export function bindEvents({
  api,
  view,
  polling,
  action,
  showLogin,
  startSession,
  loadProjects,
}) {
  const { showNotice, renderControls, renderFile, renderProject, renderLog } =
    view;
  const { stopPolling, schedulePoll, fetchDeployment, updateDeployment } =
    polling;
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
}
