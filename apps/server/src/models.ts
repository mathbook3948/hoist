export type Account = { username: string; passwordHash: string };
export type Project = {
  id: string;
  name: string;
  script: string;
  timeoutSeconds: number;
};
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
export function validateConfig(c: Config) {
  if (typeof c.host !== "string" || !c.host || /[\x00-\x20\x7f]/.test(c.host))
    throw new Error("Invalid host");
  if (!["127.0.0.1", "::1", "localhost"].includes(c.host) && !c.publicOrigin)
    throw new Error(
      "Non-loopback binding requires an explicit HTTPS publicOrigin and protected reverse proxy",
    );
  if (
    c.publicOrigin !== null &&
    (typeof c.publicOrigin !== "string" ||
      new URL(c.publicOrigin).origin !== c.publicOrigin ||
      new URL(c.publicOrigin).protocol !== "https:")
  )
    throw new Error("publicOrigin must be an HTTPS origin with no path");
  for (const [key, min, max] of [
    ["port", 1, 65535],
    ["maxArtifactBytes", 1, 64 * GiB],
    ["maxStorageBytes", 1, 1024 * GiB],
    ["uploadTimeoutSeconds", 60, 86400],
    ["artifactRetention", 1, 100],
    ["historyRetention", 1, 100],
    ["maxLogBytes", 1024, 1024 * 1024],
    ["sessionHours", 1, 24],
  ] as const)
    if (!Number.isSafeInteger(c[key]) || c[key] < min || c[key] > max)
      throw new Error(`Invalid ${key}`);
}
