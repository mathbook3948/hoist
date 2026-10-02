// Dependency-free frontend regression checks. Run: bun run test:frontend
// This DOM/fetch fixture verifies behavior, not layout or real browser semantics.
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const html = readFileSync(resolve(__dirname, "../public/index.html"), "utf8");
const publicDir = resolve(__dirname, "../public");
const entryScript = html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/);
assert.ok(entryScript, "HTML must load a frontend entry script");
assert.match(entryScript[0], /\btype="module"/);

class Element {
  constructor(tag, id = "") {
    Object.assign(this, {
      tag,
      id,
      className: "",
      children: [],
      events: {},
      hidden: false,
      disabled: false,
      checked: false,
      textContent: "",
      value: "",
      files: [],
      scrollTop: 0,
      scrollHeight: 100,
    });
    this.classList = {
      toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        if (force ?? !names.has(name)) names.add(name);
        else names.delete(name);
        this.className = [...names].join(" ");
      },
      add: (name) => this.classList.toggle(name, true),
      remove: (name) => this.classList.toggle(name, false),
    };
  }
  append(...children) {
    if (this.tag === "select" && !this.children.length && children.length)
      this.value = children[0].value;
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.children = [];
    if (this.tag === "select") this.value = "";
    this.append(...children);
  }
  setAttribute(name, value) {
    this[name] = value;
  }
  focus() {
    this.focused = true;
  }
  addEventListener(name, fn) {
    (this.events[name] ||= []).push(fn);
  }
  async emit(name, detail = {}) {
    if (this.disabled && ["click", "change"].includes(name)) return;
    for (const fn of this.events[name] || [])
      await fn({ preventDefault() {}, target: this, ...detail });
  }
  set innerHTML(value) {
    throw new Error("Untrusted HTML rendering is forbidden");
  }
}

async function fixture({
  authenticated = true,
  projects = null,
  limits = { maxArtifactBytes: 1024 ** 3, maxStorageBytes: 100 * 1024 ** 3 },
} = {}) {
  const elements = new Map(),
    generated = [],
    requests = [],
    timers = new Map();
  for (const match of html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[1], match[2]);
    element.hidden = /\bhidden\b/.test(match[0]);
    element.checked = /\bchecked\b/.test(match[0]);
    elements.set(match[2], element);
  }
  let timerId = 0,
    sequence = 1,
    isAuthenticated = authenticated,
    failNext = null,
    deferred = null;
  let rows = projects || [
    {
      id: "p1",
      name: "테스트 프로젝트",
      running: false,
      artifacts: [
        {
          id: "a1",
          name: "build.zip",
          size: 100,
          createdAt: "2026-10-02T01:00:00Z",
        },
      ],
      deployments: [],
    },
    {
      id: "p2",
      name: "<img src=x onerror=alert(1)>",
      running: false,
      artifacts: [],
      deployments: [],
    },
  ];
  const logs = new Map();
  for (const row of rows) {
    row.script ??= "/opt/hoist/scripts/deploy.sh";
    row.timeoutSeconds ??= 300;
  }
  const response = (data, status = 200) => ({
    ok: status < 400,
    status,
    json: async () => JSON.parse(JSON.stringify(data)),
  });
  const fetch = async (path, options = {}) => {
    requests.push({ path, ...options });
    if (failNext && path.includes(failNext.path)) {
      const failure = failNext;
      failNext = null;
      if (failure.error) throw failure.error;
      return response(
        { error: failure.message || "fixture error" },
        failure.status,
      );
    }
    if (deferred && path.includes(deferred.path)) return await deferred.promise;
    if (path === "/api/login") {
      isAuthenticated = true;
      return response({ username: "fixture-admin", csrf: "fixture-token" });
    }
    if (path === "/api/me")
      return isAuthenticated
        ? response({ username: "fixture-admin", csrf: "fixture-token" })
        : response({ error: "Login required" }, 401);
    if (!isAuthenticated) return response({ error: "Login required" }, 401);
    if (path === "/api/logout") {
      isAuthenticated = false;
      return response({ ok: true });
    }
    if (path === "/api/projects") {
      if (options.method === "POST") {
        const input = JSON.parse(options.body);
        if (rows.some((row) => row.id === input.id))
          return response({ error: "Project ID already exists" }, 409);
        const project = {
          ...input,
          artifacts: [],
          deployments: [],
          running: false,
        };
        rows.push(project);
        return response({ project }, 201);
      }
      return response({ projects: rows, limits, uploading: false });
    }
    const projectRoute = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projectRoute) {
      const index = rows.findIndex((row) => row.id === projectRoute[1]);
      if (index < 0) return response({ error: "Project not found" }, 404);
      if (options.method === "PUT") {
        Object.assign(rows[index], JSON.parse(options.body));
        return response({ project: rows[index] });
      }
      if (options.method === "DELETE") {
        rows.splice(index, 1);
        return response({ ok: true, dataRetained: true });
      }
    }
    const match = path.match(/^\/api\/projects\/([^/]+)\/(.*)$/),
      project = match && rows.find((row) => row.id === match[1]);
    if (!project) return response({ error: "Not found" }, 404);
    if (match[2] === "artifacts") {
      const artifact = {
        id: `a${++sequence}`,
        name: decodeURIComponent(options.headers.get("X-Artifact-Name")),
        size: options.body.size,
        createdAt: new Date().toISOString(),
      };
      project.artifacts.push(artifact);
      return response({ artifact }, 201);
    }
    if (match[2] === "deploy") {
      const body = JSON.parse(options.body);
      const deployment = {
        id: `d${++sequence}`,
        artifactId: body.artifactId,
        version: body.version,
        status: "running",
        startedAt: new Date().toISOString(),
      };
      project.deployments.push(deployment);
      project.running = true;
      logs.set(deployment.id, "fixture log\n<script>alert(1)</script>");
      return response({ deployment }, 202);
    }
    const deploymentMatch = match[2].match(/^deployments\/([^/]+)(\/cancel)?$/),
      deployment =
        deploymentMatch &&
        project.deployments.find((item) => item.id === deploymentMatch[1]);
    if (!deployment) return response({ error: "Not found" }, 404);
    if (deploymentMatch[2]) {
      deployment.status = "cancelled";
      deployment.finishedAt = new Date().toISOString();
      deployment.exitCode = 143;
      project.running = false;
      return response({ ok: true });
    }
    return response({ deployment, log: logs.get(deployment.id) || "" });
  };
  const document = {
    hidden: false,
    events: {},
    getElementById: (id) => {
      assert.ok(elements.has(id), `HTML must contain #${id}`);
      return elements.get(id);
    },
    createElement: (tag) => {
      const element = new Element(tag);
      generated.push(element);
      return element;
    },
    querySelectorAll: () =>
      generated.filter((element) =>
        /\b(project-nav|history-entry)\b/.test(element.className),
      ),
    addEventListener(name, fn) {
      (this.events[name] ||= []).push(fn);
    },
  };
  const window = {
    setTimeout: (fn, delay) => {
      timers.set(++timerId, { fn, delay });
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
    addEventListener() {},
  };
  const context = vm.createContext({
    document,
    window,
    fetch,
    Headers,
    AbortController,
    Intl,
    Date,
    Set,
    Object,
    Array,
    Number,
    Boolean,
    String,
    Error,
    TypeError,
    encodeURIComponent,
    JSON,
    console,
  });
  // A fresh module graph keeps each fixture's state isolated, as in a new page.
  const modules = new Map();
  const loadModule = (path) => {
    if (!modules.has(path))
      modules.set(
        path,
        new vm.SourceTextModule(readFileSync(path, "utf8"), {
          context,
          identifier: path,
        }),
      );
    return modules.get(path);
  };
  const entry = loadModule(resolve(publicDir, `.${entryScript[1]}`));
  await entry.link((specifier, parent) =>
    loadModule(resolve(dirname(parent.identifier), specifier)),
  );
  await entry.evaluate();
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise(setImmediate);
  };
  await settle();
  return {
    el: (id) => elements.get(id),
    requests,
    timers,
    document,
    rows,
    logs,
    settle,
    emit: async (id, name, detail) => {
      await elements.get(id).emit(name, detail);
      await settle();
    },
    hide: async (hidden) => {
      document.hidden = hidden;
      for (const fn of document.events.visibilitychange || []) fn();
      await settle();
    },
    tick: async () => {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const timer of callbacks) {
        assert.equal(timer.delay, 2000);
        timer.fn();
      }
      await settle();
    },
    fail: (path, status, message) => {
      failNext = { path, status, message };
    },
    defer: (path) => {
      let finish;
      const promise = new Promise((resolve) => {
        finish = resolve;
      });
      deferred = { path, promise };
      return (data, status = 200) => {
        deferred = null;
        finish(response(data, status));
      };
    },
  };
}

test("unauthenticated boot shows clean login and never polls", async () => {
  const f = await fixture({ authenticated: false });
  assert.equal(f.el("login-view").hidden, false);
  assert.equal(f.el("login-error").hidden, true);
  assert.equal(f.el("app-view").hidden, true);
  assert.equal(f.timers.size, 0);
});
test("authenticated boot loads projects with idle polling stopped", async () => {
  const f = await fixture();
  assert.equal(f.el("app-view").hidden, false);
  assert.equal(f.el("project-title").textContent, "테스트 프로젝트");
  assert.equal(f.el("artifact-select").value, "a1");
  assert.equal(f.timers.size, 0);
});
test("login clears password, gets session, and prevents repeated submissions", async () => {
  const f = await fixture({ authenticated: false });
  f.el("username").value = "fixture-admin";
  f.el("password").value = "fixture-only-value";
  const done = f.defer("/api/login");
  const pending = f.el("login-form").emit("submit");
  await f.settle();
  await f.el("login-form").emit("submit");
  assert.equal(f.requests.filter((r) => r.path === "/api/login").length, 1);
  done({ username: "fixture-admin", csrf: "fixture-token" });
  await pending;
  await f.settle();
  assert.equal(f.el("password").value, "");
});
test("upload uses raw body, encoded filename, credentials and CSRF", async () => {
  const f = await fixture();
  const file = { name: "배포 파일 <test>.zip", size: 512 };
  f.el("artifact-file").files = [file];
  await f.emit("artifact-file", "change");
  assert.equal(f.el("upload-button").disabled, false);
  await f.emit("upload-form", "submit");
  const request = f.requests.find((r) => r.path.endsWith("/artifacts"));
  assert.equal(request.body, file);
  assert.equal(
    request.headers.get("X-Artifact-Name"),
    encodeURIComponent(file.name),
  );
  assert.equal(request.headers.get("X-CSRF-Token"), "fixture-token");
  assert.equal(request.credentials, "same-origin");
  assert.equal(f.el("upload-button").disabled, true);
  assert.equal(f.el("artifact-select").value, "a2");
});
test("upload picker cancellation clears selection and multiple dropped files are rejected", async () => {
  const f = await fixture();
  f.el("artifact-file").files = [];
  await f.emit("artifact-file", "change");
  assert.equal(f.el("upload-button").disabled, true);
  await f.emit("drop-zone", "drop", {
    dataTransfer: {
      files: [
        { name: "a", size: 1 },
        { name: "b", size: 1 },
      ],
    },
  });
  assert.equal(f.el("upload-button").disabled, true);
  assert.match(f.el("notice-text").textContent, /하나씩/);
});
test("versioned deploy shows literal logs and starts only 2-second active polling", async () => {
  const f = await fixture();
  f.el("version-input").value = "<script>alert(1)</script>";
  await f.emit("version-input", "input");
  await f.emit("deploy-form", "submit");
  assert.equal(f.timers.size, 1);
  assert.equal(f.el("cancel-button").hidden, false);
  assert.equal(f.el("deploy-button").disabled, true);
  assert.equal(f.el("upload-button").disabled, true);
  assert.match(f.el("log-output").textContent, /<script>alert\(1\)<\/script>/);
  const request = f.requests.find((r) => r.path.endsWith("/deploy"));
  assert.equal(JSON.parse(request.body).version, "<script>alert(1)</script>");
});
test("terminal deployment stops polling and updates history", async () => {
  const f = await fixture();
  f.el("version-input").value = "v1";
  await f.emit("version-input", "input");
  await f.emit("deploy-form", "submit");
  const d = f.rows[0].deployments[0];
  d.status = "succeeded";
  d.finishedAt = new Date().toISOString();
  d.exitCode = 0;
  f.rows[0].running = false;
  await f.tick();
  assert.equal(f.timers.size, 0);
  assert.equal(f.el("log-status").textContent, "완료");
  assert.equal(f.el("cancel-button").hidden, true);
  assert.equal(f.el("history-count").textContent, 1);
  assert.equal(f.el("deploy-button").disabled, false);
});
test("hidden tab stops polling and visible active tab resumes", async () => {
  const f = await fixture();
  f.el("version-input").value = "v1";
  await f.emit("version-input", "input");
  await f.emit("deploy-form", "submit");
  await f.hide(true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.el("log-updating").hidden, true);
  await f.hide(false);
  assert.equal(f.timers.size, 1);
});
test("cancel includes CSRF and stops polling at cancelled state", async () => {
  const f = await fixture();
  f.el("version-input").value = "v1";
  await f.emit("version-input", "input");
  await f.emit("deploy-form", "submit");
  await f.emit("cancel-button", "click");
  assert.equal(f.el("log-status").textContent, "취소됨");
  assert.equal(f.timers.size, 0);
  assert.equal(
    f.requests
      .find((r) => r.path.endsWith("/cancel"))
      .headers.get("X-CSRF-Token"),
    "fixture-token",
  );
});
test("project switch clears file/version, renders name literally and stops previous polling", async () => {
  const f = await fixture();
  f.el("artifact-file").files = [{ name: "old.zip", size: 1 }];
  await f.emit("artifact-file", "change");
  f.el("version-input").value = "v1";
  await f.emit("version-input", "input");
  await f.emit("deploy-form", "submit");
  const button = f.el("project-list").children[1];
  await button.emit("click");
  await f.settle();
  assert.equal(
    f.el("project-title").textContent,
    "<img src=x onerror=alert(1)>",
  );
  assert.equal(f.el("version-input").value, "");
  assert.equal(f.el("upload-button").disabled, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.el("deploy-button").disabled, true);
  assert.match(f.el("deploy-hint").textContent, /다른 프로젝트/);
});
test("API failure reports error and restores disabled action state", async () => {
  const f = await fixture();
  f.el("artifact-file").files = [{ name: "big.zip", size: 1 }];
  await f.emit("artifact-file", "change");
  f.fail("/artifacts", 413, "Artifact too large");
  await f.emit("upload-form", "submit");
  assert.equal(f.el("notice-text").textContent, "Artifact too large");
  assert.equal(f.el("upload-button").disabled, false);
  assert.equal(f.el("upload-button").textContent, "업로드");
});
test("logout clears logs, file/password/version, and active polling", async () => {
  const f = await fixture();
  f.el("version-input").value = "v1";
  await f.emit("version-input", "input");
  await f.emit("deploy-form", "submit");
  await f.emit("logout-button", "click");
  assert.equal(f.el("login-view").hidden, false);
  assert.equal(f.el("app-view").hidden, true);
  assert.equal(f.el("version-input").value, "");
  assert.equal(f.timers.size, 0);
  assert.doesNotMatch(f.el("log-output").textContent, /fixture log/);
});
test("expired session returns to login and stops pending polling", async () => {
  const f = await fixture();
  f.fail("/api/projects", 401);
  await f.emit("refresh-button", "click");
  assert.equal(f.el("login-view").hidden, false);
  assert.equal(f.el("login-error").hidden, false);
  assert.equal(f.timers.size, 0);
});

test("empty workspace can register and select a project through the web", async () => {
  const f = await fixture({ projects: [] });
  assert.equal(f.el("empty-projects").hidden, false);
  assert.equal(f.el("project-add-button").disabled, false);
  await f.emit("project-add-button", "click");
  assert.equal(f.el("project-editor").hidden, false);
  f.el("project-id-input").value = "new-project";
  f.el("project-name-input").value = "새 프로젝트";
  f.el("project-script-input").value = "/opt/hoist/scripts/new.sh";
  f.el("project-timeout-input").value = "600";
  await f.emit("project-form", "submit");
  const request = f.requests.find(
    (r) => r.path === "/api/projects" && r.method === "POST",
  );
  assert.equal(request.headers.get("X-CSRF-Token"), "fixture-token");
  assert.equal(JSON.parse(request.body).timeoutSeconds, 600);
  assert.equal(f.el("project-title").textContent, "새 프로젝트");
  assert.equal(f.el("empty-projects").hidden, true);
  assert.equal(f.el("project-editor").hidden, true);
});

test("project settings preserve identity and update the selected project", async () => {
  const f = await fixture();
  await f.emit("project-edit-button", "click");
  assert.equal(f.el("project-id-input").readOnly, true);
  assert.equal(
    f.el("project-script-input").value,
    "/opt/hoist/scripts/deploy.sh",
  );
  f.el("project-name-input").value = "변경된 프로젝트";
  await f.emit("project-form", "submit");
  assert.equal(f.el("project-title").textContent, "변경된 프로젝트");
  assert.equal(f.el("artifact-select").value, "a1");
  assert.ok(
    f.requests.some((r) => r.path === "/api/projects/p1" && r.method === "PUT"),
  );
});

test("project removal requires a separate confirmation and selects another project", async () => {
  const f = await fixture();
  await f.emit("project-remove-button", "click");
  assert.equal(f.el("project-remove-confirm").hidden, false);
  assert.match(
    f.el("project-remove-description").textContent,
    /파일과 배포 이력은 보관/,
  );
  assert.equal(
    f.requests.some((r) => r.method === "DELETE"),
    false,
  );
  await f.emit("project-remove-cancel", "click");
  assert.equal(f.el("project-remove-confirm").hidden, true);
  await f.emit("project-remove-button", "click");
  await f.emit("project-remove-submit", "click");
  assert.equal(
    f.el("project-title").textContent,
    "<img src=x onerror=alert(1)>",
  );
  assert.equal(f.rows.length, 1);
  assert.equal(f.el("project-remove-confirm").hidden, true);
});

test("project changes are disabled during deployments and API errors keep the editor open", async () => {
  const f = await fixture();
  await f.emit("project-add-button", "click");
  f.el("project-id-input").value = "p1";
  f.el("project-name-input").value = "Duplicate";
  f.el("project-script-input").value = "/opt/hoist/scripts/deploy.sh";
  await f.emit("project-form", "submit");
  assert.equal(f.el("project-editor").hidden, false);
  assert.match(f.el("notice-text").textContent, /already exists/);
  assert.equal(f.el("project-save-button").disabled, false);
  await f.emit("project-cancel-button", "click");
  f.el("version-input").value = "v1";
  await f.emit("version-input", "input");
  await f.emit("deploy-form", "submit");
  assert.equal(f.el("project-add-button").disabled, true);
  assert.equal(f.el("project-edit-button").disabled, true);
  assert.equal(f.el("project-remove-button").disabled, true);
});

test("GiB upload limits are displayed and oversized files are rejected before sending", async () => {
  const f = await fixture();
  assert.match(f.el("upload-limits").textContent, /1\.0 GiB/);
  f.el("artifact-file").files = [{ name: "image.tar", size: 1024 ** 3 + 1 }];
  await f.emit("artifact-file", "change");
  assert.match(f.el("file-detail").textContent, /GiB/);
  assert.match(f.el("upload-hint").textContent, /초과/);
  assert.equal(f.el("upload-button").disabled, true);
  await f.emit("upload-form", "submit");
  assert.equal(
    f.requests.some((r) => r.path.endsWith("/artifacts")),
    false,
  );
});
