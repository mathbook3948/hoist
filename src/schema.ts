// Fresh development installs only. No legacy JSON import.
export const schema = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  host TEXT NOT NULL, port INTEGER NOT NULL,
  publicOrigin TEXT,
  maxArtifactBytes INTEGER NOT NULL, maxStorageBytes INTEGER NOT NULL,
  uploadTimeoutSeconds INTEGER NOT NULL,
  artifactRetention INTEGER NOT NULL, historyRetention INTEGER NOT NULL,
  maxLogBytes INTEGER NOT NULL, sessionHours INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS administrator (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL UNIQUE, passwordHash TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, script TEXT NOT NULL,
  timeoutSeconds INTEGER NOT NULL CHECK (timeoutSeconds BETWEEN 1 AND 3600),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
) STRICT;
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, size INTEGER NOT NULL CHECK (size > 0), createdAt TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS artifacts_project ON artifacts(projectId);
-- artifactId is a historical snapshot: history survives artifact retention.
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id),
  artifactId TEXT NOT NULL, version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','cancelled','timed_out','interrupted')),
  startedAt TEXT NOT NULL, finishedAt TEXT, exitCode INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS deployments_project ON deployments(projectId);
`;
