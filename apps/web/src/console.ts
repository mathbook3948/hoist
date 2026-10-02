import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Artifact,
  Config,
  Deployment,
  Project,
  ProjectInput,
} from "../../server/src/models";
import { byNewest, isActive } from "./display";

export type ProjectView = Project & {
  artifacts: Artifact[];
  deployments: Deployment[];
  running: string | null;
};
type Listing = {
  projects: ProjectView[];
  limits: Pick<Config, "maxArtifactBytes" | "maxStorageBytes">;
  uploading: boolean;
  managementBusy: boolean;
};
type State = {
  loadingProjects: boolean;
  booting: boolean;
  user: string | null;
  csrf: string;
  projects: ProjectView[];
  projectId: string | null;
  deploymentId: string | null;
  deployment: Deployment | null;
  limits: Listing["limits"] | null;
  serverBusy: boolean;
  managementBusy: boolean;
  file: File | null;
  artifactId: string;
  version: string;
  busy: string | null;
  log: string;
  loadingLog: boolean;
  notice: string;
  noticeError: boolean;
  loginError: string;
  refresh: number;
  visible: boolean;
};
const routeProject = () =>
  window.location.pathname === "/" ? null : window.location.pathname.slice(1);
const initial = (): State => ({
  loadingProjects: true,
  booting: true,
  user: null,
  csrf: "",
  projects: [],
  projectId: routeProject(),
  deploymentId: null,
  deployment: null,
  limits: null,
  serverBusy: false,
  managementBusy: false,
  file: null,
  artifactId: "",
  version: "",
  busy: null,
  log: "배포를 시작하거나 이력에서 항목을 선택하면 로그가 표시됩니다",
  loadingLog: false,
  notice: "",
  noticeError: false,
  loginError: "",
  refresh: 0,
  visible: !document.hidden,
});
class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const describe = (error: unknown) =>
  error instanceof TypeError
    ? "서버에 연결할 수 없습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요"
    : error instanceof Error
      ? error.message
      : "요청을 완료하지 못했습니다";
type RequestOptions = RequestInit & { json?: unknown };

export function useConsole() {
  const [state, setState] = useState(initial);
  const current = useRef(state);
  const session = useRef(0);
  const mounted = useRef(false);
  const navigation = useRef(0);
  const update = useCallback((patch: Partial<State>) => {
    if (!mounted.current) return;
    current.current = { ...current.current, ...patch };
    setState(current.current);
  }, []);
  const clearSession = useCallback(
    (expired = false) => {
      session.current++;
      update({
        ...initial(),
        booting: false,
        loginError: expired
          ? "세션이 만료되었습니다. 다시 로그인해 주세요"
          : "",
      });
    },
    [update],
  );
  const request = useCallback(
    async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
      const epoch = session.current;
      const { json, ...init } = options;
      const headers = new Headers(init.headers);
      if (init.method && init.method !== "GET")
        headers.set("X-CSRF-Token", current.current.csrf);
      if (json !== undefined) headers.set("Content-Type", "application/json");
      const response = await fetch(path, {
        ...init,
        credentials: "same-origin",
        headers,
        body: json !== undefined ? JSON.stringify(json) : init.body,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (
          response.status === 401 &&
          path !== "/api/login" &&
          epoch === session.current
        )
          clearSession(Boolean(current.current.user));
        throw new APIError(
          data.error || `요청을 완료하지 못했습니다 (${response.status})`,
          response.status,
        );
      }
      return data as T;
    },
    [clearSession],
  );
  const loadProjects = useCallback(
    async (preserve = true) => {
      const epoch = session.current;
      const result = await request<Listing>("/api/projects").catch((error) => {
        if (epoch === session.current) update({ loadingProjects: false });
        throw error;
      });
      if (epoch !== session.current || !mounted.current) return;
      const before = current.current;
      const selectedId = routeProject();
      const project = result.projects.find((p) => p.id === selectedId);
      const same = preserve && project?.id === before.projectId;
      const deployments = byNewest(project?.deployments || [], "startedAt");
      const deployment =
        (same && deployments.find((d) => d.id === before.deploymentId)) ||
        deployments.find(isActive) ||
        deployments[0] ||
        null;
      const artifacts = byNewest(project?.artifacts || [], "createdAt");
      update({
        loadingProjects: false,
        projects: result.projects,
        limits: result.limits,
        serverBusy: result.uploading,
        managementBusy: result.managementBusy,
        projectId: selectedId,
        deploymentId: deployment?.id || null,
        deployment,
        artifactId:
          same && artifacts.some((a) => a.id === before.artifactId)
            ? before.artifactId
            : artifacts[0]?.id || "",
        ...(!same
          ? { file: null, version: "", log: initial().log, loadingLog: false }
          : {}),
      });
    },
    [request, update],
  );
  const syncRoute = useCallback(() => {
    update({
      projectId: routeProject(),
      deploymentId: null,
      deployment: null,
      file: null,
      version: "",
      artifactId: "",
      log: initial().log,
      loadingLog: false,
      loadingProjects: true,
    });
  }, [update]);
  const navigate = (id: string | null, replace = false) => {
    window.history[replace ? "replaceState" : "pushState"](
      {},
      "",
      id ? `/${encodeURIComponent(id)}` : "/",
    );
    syncRoute();
  };
  useEffect(() => {
    const pop = () => {
      navigation.current++;
      syncRoute();
      if (current.current.user)
        void loadProjects(false).catch((error) =>
          update({
            loadingProjects: false,
            notice: describe(error),
            noticeError: true,
          }),
        );
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [syncRoute, loadProjects, update]);
  const startSession = useCallback(async () => {
    const epoch = session.current;
    const me = await request<{ username: string; csrf: string }>("/api/me");
    if (epoch !== session.current || !mounted.current) return;
    update({
      user: me.username,
      csrf: me.csrf,
      booting: false,
      loginError: "",
    });
    await loadProjects();
  }, [request, update, loadProjects]);
  useEffect(() => {
    mounted.current = true;
    void startSession().catch((error) => {
      if (
        !mounted.current ||
        (error instanceof APIError && error.status === 401)
      )
        return;
      update(
        current.current.user
          ? { notice: describe(error), noticeError: true }
          : { booting: false, loginError: describe(error) },
      );
    });
    return () => {
      mounted.current = false;
      session.current++;
    };
  }, [startSession, update]);

  // A selection owns its request and timer. Cleanup invalidates late responses.
  useEffect(() => {
    if (!state.user || !state.projectId || !state.deploymentId) return;
    const projectId = state.projectId,
      deploymentId = state.deploymentId;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const stop = () => {
      clearTimeout(timer);
      controller?.abort();
    };
    const poll = async () => {
      if (disposed || document.hidden) return;
      const activeController = new AbortController();
      controller = activeController;
      update({ loadingLog: true });
      try {
        const result = await request<{ deployment: Deployment; log: string }>(
          `/api/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}`,
          { signal: activeController.signal },
        );
        if (
          disposed ||
          activeController.signal.aborted ||
          current.current.projectId !== projectId ||
          current.current.deploymentId !== deploymentId ||
          !current.current.user
        )
          return;
        const wasRunning = isActive(current.current.deployment);
        const projects = current.current.projects.map((p) => {
          if (p.id !== projectId) return p;
          const deployments = [
            result.deployment,
            ...p.deployments.filter((d) => d.id !== deploymentId),
          ];
          return {
            ...p,
            deployments,
            running: deployments.find(isActive)?.id || null,
          };
        });
        update({
          deployment: result.deployment,
          projects,
          log:
            result.log ||
            (isActive(result.deployment)
              ? "실행 로그를 기다리고 있습니다…"
              : "기록된 로그가 없습니다"),
        });
        if (wasRunning && !isActive(result.deployment)) await loadProjects();
      } catch (error) {
        if (
          !disposed &&
          !activeController.signal.aborted &&
          current.current.user
        )
          update({ notice: describe(error), noticeError: true });
      } finally {
        if (
          !disposed &&
          !activeController.signal.aborted &&
          controller === activeController
        ) {
          update({ loadingLog: false });
          if (
            !document.hidden &&
            current.current.user &&
            isActive(current.current.deployment)
          )
            timer = setTimeout(poll, 2000);
        }
      }
    };
    const visibility = () => {
      stop();
      update({ visible: !document.hidden, loadingLog: false });
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => {
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [
    state.user,
    state.projectId,
    state.deploymentId,
    state.refresh,
    request,
    update,
    loadProjects,
  ]);

  async function action(
    name: string,
    work: (valid: () => boolean) => Promise<void>,
  ) {
    if (current.current.busy) return false;
    const epoch = session.current;
    const routeEpoch = navigation.current;
    const valid = () =>
      mounted.current &&
      epoch === session.current &&
      routeEpoch === navigation.current;
    update({ busy: name, notice: "", noticeError: false });
    try {
      await work(valid);
      return valid();
    } catch (error) {
      if (valid())
        update({
          loadingProjects: false,
          notice: describe(error),
          noticeError: true,
        });
      return false;
    } finally {
      if (mounted.current && epoch === session.current) update({ busy: null });
    }
  }
  async function login(username: string, password: string) {
    if (current.current.busy) return;
    update({ busy: "login", loginError: "" });
    try {
      await request("/api/login", {
        method: "POST",
        json: { username: username.trim(), password },
      });
      await startSession();
    } catch (error) {
      update(
        current.current.user
          ? { notice: describe(error), noticeError: true }
          : {
              loginError:
                error instanceof APIError && error.status === 401
                  ? "사용자 이름 또는 비밀번호를 확인해 주세요"
                  : describe(error),
            },
      );
    } finally {
      update({ busy: null });
    }
  }
  const project = state.projects.find((p) => p.id === state.projectId);
  const anyRunning = state.projects.some(
    (p) => p.running || p.deployments.some(isActive),
  );
  const managementBusy = Boolean(
    state.busy || state.serverBusy || state.managementBusy || anyRunning,
  );
  return {
    state,
    project,
    anyRunning,
    managementBusy,
    update,
    login,
    logout: () =>
      action("logout", async (valid) => {
        await request("/api/logout", { method: "POST" });
        if (valid()) clearSession();
      }),
    selectProject: (id: string | null) => {
      if (current.current.busy) return;
      navigation.current++;
      navigate(id);
      return action("select", async (valid) => {
        await loadProjects(false);
        if (valid()) update({ refresh: current.current.refresh + 1 });
      });
    },
    selectDeployment: (deployment: Deployment) => {
      if (!current.current.busy)
        update({
          deploymentId: deployment.id,
          deployment,
          log: "실행 로그를 불러오는 중…",
          refresh: current.current.refresh + 1,
        });
    },
    upload: () =>
      action("upload", async (valid) => {
        const { file, projectId, limits } = current.current;
        if (
          !file ||
          !projectId ||
          (limits && file.size > limits.maxArtifactBytes)
        )
          return;
        const result = await request<{ artifact: Artifact }>(
          `/api/projects/${encodeURIComponent(projectId)}/artifacts`,
          {
            method: "POST",
            body: file,
            headers: {
              "Content-Type": "application/octet-stream",
              "X-Artifact-Name": encodeURIComponent(file.name),
            },
          },
        );
        if (!valid()) return;
        await loadProjects();
        if (valid())
          update({
            file: null,
            artifactId: result.artifact.id,
            notice: `‘${file.name}’ 업로드가 완료됐어요. 버전을 입력하고 배포를 시작하세요`,
          });
      }),
    deploy: () =>
      action("deploy", async (valid) => {
        const { projectId, artifactId, version } = current.current;
        const result = await request<{ deployment: Deployment }>(
          `/api/projects/${encodeURIComponent(projectId!)}/deploy`,
          { method: "POST", json: { artifactId, version: version.trim() } },
        );
        if (!valid()) return;
        if (!result.deployment?.id)
          throw new Error(
            "배포 실행 ID를 확인하지 못했습니다. 새로고침으로 상태를 확인해 주세요",
          );
        const projects = current.current.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                deployments: [result.deployment, ...p.deployments],
                running: result.deployment.id,
              }
            : p,
        );
        update({
          projects,
          deploymentId: result.deployment.id,
          deployment: result.deployment,
          log: "실행 로그를 불러오는 중…",
          notice: `‘${version.trim()}’ 배포를 시작했어요`,
          refresh: current.current.refresh + 1,
        });
      }),
    cancel: () =>
      action("cancel", async (valid) => {
        const { projectId, deploymentId } = current.current;
        await request(
          `/api/projects/${encodeURIComponent(projectId!)}/deployments/${encodeURIComponent(deploymentId!)}/cancel`,
          { method: "POST" },
        );
        if (valid())
          update({
            refresh: current.current.refresh + 1,
            notice: "실행 취소를 요청했어요",
          });
      }),
    getProjectScript: (id: string) =>
      request<{ scriptContent: string }>(
        `/api/projects/${encodeURIComponent(id)}/script`,
      ),
    saveProject: (input: ProjectInput, editingId?: string) =>
      action("save", async (valid) => {
        const result = await request<{ project: Project }>(
          editingId
            ? `/api/projects/${encodeURIComponent(editingId)}`
            : "/api/projects",
          { method: editingId ? "PUT" : "POST", json: input },
        );
        if (!valid()) return;
        if (!editingId) navigate(result.project.id);
        await loadProjects(false);
        if (valid())
          update({
            notice: editingId
              ? "프로젝트 설정을 저장했어요"
              : "프로젝트를 등록했어요",
          });
      }),
    removeProject: (id: string) =>
      action("remove", async (valid) => {
        await request(`/api/projects/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (!valid()) return;
        navigate(null, true);
        await loadProjects(false);
        if (valid())
          update({
            notice:
              "프로젝트 등록을 해제했어요. 기존 파일과 배포 이력은 보관됩니다",
          });
      }),
  };
}
export type Console = ReturnType<typeof useConsole>;
