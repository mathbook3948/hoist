export const state = {
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
  limits: null,
  serverBusy: false,
};
const activeStatuses = new Set([
  "running",
  "queued",
  "pending",
  "starting",
  "cancelling",
  "canceling",
]);
export const isActive = (deployment) =>
  Boolean(deployment && activeStatuses.has(deployment.status));
export const project = () =>
  state.projects.find((item) => String(item.id) === state.projectId);
export const byNewest = (items, key) =>
  [...(items || [])].sort(
    (a, b) => (Date.parse(b[key]) || 0) - (Date.parse(a[key]) || 0),
  );
