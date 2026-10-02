import {
  openSync,
  writeSync,
  closeSync,
  unlinkSync,
  existsSync,
  fsyncSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type Config,
  type Project,
  Store,
  projectDir,
  storedArtifactBytes,
} from "./store";
import { fail } from "./http";

export function createArtifacts(
  store: Store,
  config: Config,
  isDeploying: (projectId: string) => boolean,
) {
  const dir = store.dir;
  let uploading = false;
  let stopped = false;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  async function upload(req: Request, p: Project) {
    if (stopped) fail(503, "Shutting down");
    if (uploading || isDeploying(p.id)) fail(409, "Upload/deployment busy");
    uploading = true;
    const id = randomUUID(),
      target = join(projectDir(dir, p.id), "artifacts", id + ".bin");
    let fd: number | undefined,
      reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let committed = false;
    let size = 0,
      timedOut = false;
    const uploadDeadline = setTimeout(() => {
      timedOut = true;
      void reader?.cancel().catch(() => {});
    }, config.uploadTimeoutSeconds * 1000);
    try {
      let name: string;
      try {
        name = decodeURIComponent(
          req.headers.get("x-artifact-name") || "artifact.bin",
        );
      } catch {
        fail(400, "Invalid filename");
      }
      if (
        name.length > 160 ||
        !name.length ||
        /[\x00-\x1f\x7f/\\]/.test(name) ||
        name === "." ||
        name === ".."
      )
        fail(400, "Invalid filename");
      const used = storedArtifactBytes(dir);
      const length = req.headers.get("content-length");
      if (
        length &&
        (!/^\d+$/.test(length) || Number(length) > config.maxArtifactBytes)
      )
        fail(413, "Artifact too large");
      if (length && used + Number(length) > config.maxStorageBytes)
        fail(413, "Storage quota reached");
      if (!req.body) fail(400, "Artifact body required");
      fd = openSync(target, "wx", 0o600);
      reader = req.body.getReader();
      activeReader = reader;
      while (true) {
        const chunk = await reader.read();
        if (stopped) fail(503, "Shutting down");
        if (timedOut) fail(408, "Upload deadline exceeded");
        if (chunk.done) break;
        size += chunk.value.length;
        if (
          size > config.maxArtifactBytes ||
          used + size > config.maxStorageBytes
        )
          fail(413, "Upload or storage limit exceeded");
        let offset = 0;
        while (offset < chunk.value.length)
          offset += writeSync(fd, chunk.value, offset);
      }
      if (!size) fail(400, "Empty artifact");
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      const artifact = {
        id,
        name,
        size,
        createdAt: new Date().toISOString(),
      };
      store.addArtifact(p.id, artifact);
      committed = true;
      store.trim(p.id, config);
      return artifact;
    } catch (e) {
      if (reader) await reader.cancel().catch(() => {});
      if (fd !== undefined) closeSync(fd);
      if (!committed && existsSync(target)) unlinkSync(target);
      throw e;
    } finally {
      clearTimeout(uploadDeadline);
      activeReader = undefined;
      uploading = false;
    }
  }

  return {
    upload,
    isUploading: () => uploading,
    shutdown: () => {
      stopped = true;
      void activeReader?.cancel().catch(() => {});
    },
    waitForIdle: async () => {
      while (uploading) await new Promise((resolve) => setTimeout(resolve, 50));
    },
  };
}
