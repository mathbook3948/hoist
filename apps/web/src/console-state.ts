import type {
  Artifact,
  Config,
  Deployment,
  Project,
} from "../../server/src/models";

export type ProjectView = Project & {
  artifacts: Artifact[];
  deployments: Deployment[];
  running: string | null;
};
export type Listing = {
  projects: ProjectView[];
  limits: Pick<Config, "maxArtifactBytes" | "maxStorageBytes">;
  uploading: boolean;
  managementBusy: boolean;
};
export type ConsoleState = {
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
};
export const readRoute = () => {
  const [projectId, deploymentId] = window.location.pathname
    .slice(1)
    .split("/");
  return { projectId: projectId || null, deploymentId: deploymentId || null };
};
export const DEFAULT_LOG =
  "배포를 시작하거나 이력에서 항목을 선택하면 로그가 표시됩니다";

export const initialConsoleState = (): ConsoleState => ({
  loadingProjects: true,
  booting: true,
  user: null,
  csrf: "",
  projects: [],
  ...readRoute(),
  deployment: null,
  limits: null,
  serverBusy: false,
  managementBusy: false,
  file: null,
  artifactId: "",
  version: "",
  busy: null,
  log: DEFAULT_LOG,
  loadingLog: false,
  notice: "",
  noticeError: false,
  loginError: "",
  refresh: 0,
});
