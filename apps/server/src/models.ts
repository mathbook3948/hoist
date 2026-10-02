export type Account = { username: string; passwordHash: string };
export type Project = {
  id: string;
  name: string;
  script: string;
  timeoutSeconds: number;
};
export type ProjectInput = {
  name: string;
  scriptContent: string;
  timeoutSeconds: number;
};
export const defaultDeployScript = `#!/bin/sh
set -eu

# $1: uploaded artifact path, $2: version
echo "Configure the deployment script before running a deployment." >&2
exit 1
`;
export type Config = {
  host: string;
  port: number;
  publicOrigin: string | null;
  maxArtifactBytes: number;
  maxStorageBytes: number;
  uploadTimeoutSeconds: number;
  artifactRetention: number;
  historyRetention: number;
  maxLogBytes: number;
  sessionHours: number;
};
export type Artifact = {
  id: string;
  name: string;
  size: number;
  createdAt: string;
};
export type Deployment = {
  id: string;
  artifactId: string;
  version: string;
  status:
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "timed_out"
    | "interrupted";
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
};
export type State = { artifacts: Artifact[]; deployments: Deployment[] };
export const validId = (v: string) => /^[a-zA-Z0-9_-]{1,64}$/.test(v);
export const GiB = 1024 ** 3;
export const defaultLimits = {
  maxArtifactBytes: GiB,
  maxStorageBytes: 100 * GiB,
  uploadTimeoutSeconds: 3600,
};
export const defaultConfig: Config = {
  host: "127.0.0.1",
  port: 3000,
  publicOrigin: null,
  ...defaultLimits,
  artifactRetention: 5,
  historyRetention: 30,
  maxLogBytes: 64 * 1024,
  sessionHours: 8,
};
