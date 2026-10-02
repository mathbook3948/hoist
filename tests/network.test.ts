import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createIPFilter,
  createClientIPResolver,
} from "../apps/server/src/network";
import { readSettings } from "../apps/server/src/settings";
import { resolveDataDir } from "../apps/server/src/paths";
import { Store } from "../apps/server/src/store";
import { startServer } from "../apps/server/src/server";

test("default and individual IP rules accept only that address, including mapped IPv4", () => {
  const allow = createIPFilter();
  for (const ip of ["127.0.0.1", "::ffff:127.0.0.1", "::ffff:7f00:1"])
    expect(allow(ip)).toBe(true);
  for (const ip of [
    undefined,
    "unknown",
    "127.0.0.2",
    "::1",
    "100.64.0.1",
    "192.168.1.1",
  ])
    expect(allow(ip)).toBe(false);
  const single = createIPFilter("100.80.90.10");
  expect(single("100.80.90.10")).toBe(true);
  expect(single("100.80.90.11")).toBe(false);
  const v6 = createIPFilter("::1");
  expect(v6("0:0:0:0:0:0:0:1")).toBe(true);
  expect(v6("::2")).toBe(false);
});

test("CIDR boundaries and IPv6 forms are matched without widening the configured range", () => {
  const allow = createIPFilter("100.64.0.0/10");
  for (const ip of ["100.64.0.0", "100.127.255.255", "::ffff:100.80.1.2"])
    expect(allow(ip)).toBe(true);
  for (const ip of [
    "100.63.255.255",
    "100.128.0.0",
    "127.0.0.1",
    "fd7a:115c:a1e0::1",
  ])
    expect(allow(ip)).toBe(false);
  const v6 = createIPFilter("fd7a:115c:a1e0::/48");
  expect(v6("fd7a:115c:a1e0:ffff:ffff:ffff:ffff:ffff")).toBe(true);
  expect(v6("FD7A:115C:A1E0::1")).toBe(true);
  expect(v6("fd7a:115c:a1e1::1")).toBe(false);
  expect(v6("100.64.0.1")).toBe(false);
  expect(createIPFilter("192.0.2.1/32")("192.0.2.2")).toBe(false);
  expect(createIPFilter("::1/128")("::2")).toBe(false);
});

test("malformed rules and lists are rejected instead of permitting requests", () => {
  for (const rule of [
    null,
    [],
    ["127.0.0.1"],
    123,
    "",
    "localhost",
    "*",
    "127.1",
    "127.0.0.1:3000",
    "127.0.0.1,::1",
    " 127.0.0.1",
    "1.2.3.4/33",
    "::/129",
    "::/-1",
    "::/",
    "::/01",
    "::/1/2",
    "fe80::1%eth0",
  ])
    expect(() => createIPFilter(rule)).toThrow();
});

test("settings accept a single allowedIP alongside dataDir and reject invalid policy", () => {
  const home = mkdtempSync(join(tmpdir(), "hoist-network-settings-"));
  try {
    expect(readSettings(home)).toEqual({});
    mkdirSync(join(home, ".hoist"));
    const path = join(home, ".hoist/settings.json");
    writeFileSync(
      path,
      JSON.stringify({ dataDir: "storage", allowedIP: "100.64.0.0/10" }),
    );
    expect(readSettings(home).allowedIP).toBe("100.64.0.0/10");
    expect(resolveDataDir(undefined, { home, env: {} })).toBe(
      join(home, ".hoist/storage"),
    );
    for (const allowedIP of [null, [], "bad", "100.64.0.0/33"]) {
      writeFileSync(path, JSON.stringify({ allowedIP }));
      expect(() => readSettings(home)).toThrow("allowedIP");
    }
    writeFileSync(path, '{"allowedIPs":["127.0.0.1"]}');
    expect(() => readSettings(home)).toThrow();
    writeFileSync(path, JSON.stringify({ trustedProxy: "127.0.0.0/8" }));
    expect(readSettings(home).trustedProxy).toBe("127.0.0.0/8");
    for (const trustedProxy of [null, [], "", "localhost", "127.0.0.1/33"]) {
      writeFileSync(path, JSON.stringify({ trustedProxy }));
      expect(() => readSettings(home)).toThrow("trustedProxy");
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("proxy chains stop at the closest untrusted hop and normalize client identities", () => {
  const resolve = createClientIPResolver("127.0.0.0/8");
  expect(createClientIPResolver()("127.0.0.1", "100.80.1.2")).toBe("127.0.0.1");
  expect(resolve("192.0.2.1", "100.80.1.2")).toBe("192.0.2.1");
  expect(resolve("192.0.2.1", "invalid")).toBe("192.0.2.1");
  expect(resolve(undefined, "100.80.1.2")).toBeUndefined();
  expect(resolve("::ffff:127.0.0.1", "100.80.1.2, 127.0.0.2")).toBe(
    "100.80.1.2",
  );
  expect(resolve("127.0.0.1", "100.80.1.2, 192.0.2.1, 127.0.0.2")).toBe(
    "192.0.2.1",
  );
  expect(resolve("127.0.0.1", "::ffff:6450:102")).toBe("100.80.1.2");
  expect(resolve("127.0.0.1", "FD7A:115C:A1E0:0:0:0:0:1")).toBe(
    "fd7a:115c:a1e0::1",
  );
  const v6 = createClientIPResolver("fd00::/64");
  expect(v6("fd00::1", "100.80.1.2, fd00::2")).toBe("100.80.1.2");
  for (const header of [
    null,
    "",
    "unknown",
    "127.0.0.1",
    "127.0.0.1,127.0.0.2",
    "100.80.1.2,",
    "bad,100.80.1.2",
    "100.80.1.2:123",
    "[::1]",
    "fe80::1%eth0",
    "a".repeat(4097),
    Array(33).fill("100.80.1.2").join(","),
  ])
    expect(resolve("127.0.0.1", header)).toBeUndefined();
});

test("trusted proxy HTTP enforces client access and separates login throttles by normalized client IP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hoist-proxy-http-"));
  let runtime: ReturnType<typeof startServer> | undefined;
  try {
    const store = new Store(dir);
    const reserve = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(),
    });
    const port = reserve.port;
    await reserve.stop(true);
    store.setConfig({ ...store.getConfig(), port });
    runtime = startServer(store, {
      allowedIP: "100.64.0.0/10",
      trustedProxy: "127.0.0.1",
    });
    const origin = `http://127.0.0.1:${port}`;
    for (const path of [
      "/",
      "/api/me",
      "/api/login",
      "/api/projects",
      "/assets/missing.js",
    ]) {
      for (const forwarded of [
        undefined,
        "invalid",
        "192.0.2.1",
        "100.80.1.2,192.0.2.1",
      ]) {
        const response = await fetch(origin + path, {
          method: path === "/api/login" ? "POST" : "GET",
          headers: {
            ...(forwarded ? { "X-Forwarded-For": forwarded } : {}),
            "X-Real-IP": "100.80.1.2",
            Forwarded: "for=100.80.1.2",
          },
        });
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: "IP address rejected" });
      }
    }
    const me = await fetch(origin + "/api/me", {
      headers: { "X-Forwarded-For": "100.80.1.2" },
    });
    expect(me.status).toBe(401);
    const login = (ip: string) =>
      fetch(origin + "/api/login", {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "X-Forwarded-For": ip,
        },
        body: "{}",
      });
    for (let i = 0; i < 10; i++)
      expect((await login("100.80.1.2")).status).toBe(400);
    expect((await login("::ffff:6450:102")).status).toBe(429);
    expect((await login("100.80.1.3")).status).toBe(400);
  } finally {
    await runtime?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HTTP denies every route before auth, ignores spoofed forwarding headers, and permits the configured peer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hoist-network-http-"));
  let runtime: ReturnType<typeof startServer> | undefined;
  try {
    for (const allowedIP of ["100.64.0.0/10", "127.0.0.1"]) {
      const store = new Store(dir);
      const reserve = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => new Response(),
      });
      const port = reserve.port;
      await reserve.stop(true);
      store.setConfig({ ...store.getConfig(), port });
      runtime = startServer(store, { allowedIP });
      const origin = `http://127.0.0.1:${port}`;
      for (const path of [
        "/",
        "/api/me",
        "/api/login",
        "/api/projects",
        "/assets/missing.js",
      ]) {
        const response = await fetch(origin + path, {
          method: path === "/api/login" ? "POST" : "GET",
          headers: {
            "X-Forwarded-For": "100.80.1.2",
            "X-Real-IP": "100.80.1.2",
            Forwarded: "for=100.80.1.2",
          },
        });
        if (allowedIP !== "127.0.0.1") {
          expect(response.status).toBe(403);
          expect(await response.json()).toEqual({
            error: "IP address rejected",
          });
          expect(response.headers.get("set-cookie")).toBeNull();
        } else {
          expect(await response.text()).not.toContain("IP address rejected");
          if (path === "/api/me") expect(response.status).toBe(401);
        }
      }
      await runtime.stop();
      runtime = undefined;
    }
  } finally {
    await runtime?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
