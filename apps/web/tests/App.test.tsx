import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { App } from "../src/App";
import { DataTable } from "../src/components/DataTable";
import type { ProjectView } from "../src/console";

const artifact = {
  id: "a1",
  name: "release.tar",
  size: 1024,
  createdAt: "2026-01-01",
};
const deployment = {
  id: "d1",
  artifactId: "a1",
  version: "v1",
  status: "running" as const,
  startedAt: "2026-01-01",
};
const demo = (): ProjectView => ({
  id: "demo",
  name: "Demo",
  script: "/trusted/demo.sh",
  timeoutSeconds: 300,
  artifacts: [artifact],
  deployments: [],
  running: null,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function fixture(
  authenticated = true,
  initialProjects = [demo()],
  path = initialProjects.length ? "/demo" : "/",
) {
  window.history.replaceState({}, "", path);
  const data = {
    authenticated,
    projects: initialProjects,
    status: "running",
    log: "<script>alert(1)</script>\nlog output",
    managementBusy: false,
    uploading: false,
    intercept: undefined as
      | undefined
      | ((
          path: string,
          init: RequestInit,
        ) => Response | Promise<Response> | undefined),
  };
  const fetcher = vi.fn(
    async (input: string | URL | Request, init: RequestInit = {}) => {
      const path = String(input),
        method = init.method || "GET";
      const intercepted = data.intercept?.(path, init);
      if (intercepted) return await intercepted;
      if (path === "/api/login") {
        data.authenticated = true;
        return json({ ok: true });
      }
      if (!data.authenticated) return json({ error: "Login required" }, 401);
      if (path === "/api/me")
        return json({ username: "admin", csrf: "csrf-fixture" });
      if (path === "/api/logout") {
        data.authenticated = false;
        return json({ ok: true });
      }
      if (path.endsWith("/cancel")) {
        data.status = "cancelled";
        data.projects[0].deployments = [{ ...deployment, status: "cancelled" }];
        data.projects[0].running = null;
        return json({ ok: true });
      }
      if (path.includes("/deployments/"))
        return json({
          deployment: { ...deployment, status: data.status },
          log: data.log,
        });
      if (path.endsWith("/artifacts")) {
        const uploaded = {
          ...artifact,
          id: "a2",
          name: decodeURIComponent(
            new Headers(init.headers).get("X-Artifact-Name")!,
          ),
        };
        data.projects[0].artifacts.push(uploaded);
        return json({ artifact: uploaded }, 201);
      }
      if (path.endsWith("/deploy")) {
        const inputBody = JSON.parse(String(init.body));
        const launched = { ...deployment, ...inputBody };
        data.projects[0].deployments = [launched];
        data.projects[0].running = launched.id;
        return json({ deployment: launched }, 202);
      }
      if (path.endsWith("/script") && method === "GET")
        return json({ scriptContent: "#!/bin/sh\necho existing\n" });
      if (path === "/api/projects" && method === "GET")
        return json({
          projects: data.projects,
          limits: {
            maxArtifactBytes: 1024 ** 3,
            maxStorageBytes: 100 * 1024 ** 3,
          },
          uploading: data.uploading,
          managementBusy: data.managementBusy,
        });
      if (method === "POST" && path === "/api/projects") {
        const inputBody = JSON.parse(String(init.body));
        inputBody.id = "generated-id";
        data.projects.push({
          ...inputBody,
          artifacts: [],
          deployments: [],
          running: null,
        });
        return json({ project: inputBody }, 201);
      }
      if (method === "PUT") {
        const project = Object.assign(
          data.projects.find((p) => path.endsWith(p.id))!,
          JSON.parse(String(init.body)),
        );
        return json({ project });
      }
      if (method === "DELETE") {
        data.projects = data.projects.filter((p) => !path.endsWith(p.id));
        return json({ ok: true });
      }
      throw new Error(`Unexpected request ${method} ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<App />);
  return { data, fetcher, user };
}
async function ready() {
  await screen.findByRole("heading", { name: "Demo", level: 1 });
}
const callsTo = (
  fetcher: ReturnType<typeof fixture>["fetcher"],
  suffix: string,
) => fetcher.mock.calls.filter(([path]) => String(path).endsWith(suffix));

describe("React deployment console", () => {
  test("table rows activate once, preserve keyboard buttons and block busy clicks", async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    const row = { id: "one" };
    const props = {
      label: "Rows",
      rows: [row],
      rowKey: (item: typeof row) => item.id,
      emptyMessage: "Empty",
      onRowClick: select,
      columns: [
        {
          id: "name",
          header: "Name",
          cell: () => (
            <button onClick={() => select(row)}>
              <span>Open</span>
            </button>
          ),
        },
        { id: "status", header: "Status", cell: () => "Done" },
      ],
    };
    const view = render(<DataTable {...props} />);
    await user.click(screen.getByRole("cell", { name: "Done" }));
    expect(select).toHaveBeenCalledExactlyOnceWith(row);
    select.mockClear();
    await user.click(screen.getByText("Open"));
    expect(select).toHaveBeenCalledExactlyOnceWith(row);
    select.mockClear();
    await user.keyboard("{Enter}");
    expect(select).toHaveBeenCalledExactlyOnceWith(row);
    select.mockClear();
    view.rerender(<DataTable {...props} disabled />);
    await user.click(screen.getByRole("cell", { name: "Done" }));
    expect(select).not.toHaveBeenCalled();
  });
  test("home lists projects without a sidebar and navigation follows browser history", async () => {
    const { user } = fixture(true, [demo()], "/");
    const link = await screen.findByRole("link", { name: /Demo/ });
    const table = screen.getByRole("table", { name: "프로젝트 목록" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual([
      "이름",
      "최근 버전",
      "배포 상태",
      "소요 시간",
      "보관 용량",
      "최근 배포 시각",
    ]);
    expect(
      within(table).getByRole("cell", { name: "1.0 KiB" }),
    ).toBeInTheDocument();
    expect(link).toBeEnabled();
    expect(screen.queryByLabelText("배포 실행 로그")).toBeNull();
    expect(document.querySelector("aside")).toBeNull();
    expect(screen.getByRole("button", { name: "등록" })).toBeInTheDocument();
    await user.click(within(table).getAllByRole("cell")[1]);
    await ready();
    expect(window.location.pathname).toBe("/demo");
    expect(
      screen.queryByRole("button", { name: "등록", exact: true }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "설정", exact: true }),
    ).toBeInTheDocument();
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 30));
    });
    await screen.findByRole("link", { name: /Demo/ });
    expect(window.location.pathname).toBe("/");
    await act(async () => {
      window.history.forward();
      await new Promise((r) => setTimeout(r, 30));
    });
    await ready();
    expect(window.location.pathname).toBe("/demo");
  });
  test("unknown project URL never silently selects another project", async () => {
    fixture(true, [demo()], "/missing");
    await screen.findByText("존재하지 않거나 삭제된 프로젝트입니다.");
    expect(window.location.pathname).toBe("/missing");
    expect(
      screen.queryByRole("button", { name: "등록", exact: true }),
    ).toBeNull();
    expect(screen.queryByLabelText("배포 실행 로그")).toBeNull();
  });
  test("history leads the detail view and exposes deployment metadata", async () => {
    const project = demo();
    project.deployments = [
      {
        ...deployment,
        status: "succeeded",
        finishedAt: "2026-01-01T00:01:05Z",
        exitCode: 0,
      },
    ];
    const { data, fetcher, user } = fixture(true, [project]);
    data.intercept = (path) =>
      path.includes("/deployments/")
        ? json({ deployment: project.deployments[0], log: "done" })
        : undefined;
    await ready();
    const history = screen.getByRole("table", { name: "배포 이력" });
    expect(within(history).getAllByRole("columnheader")).toHaveLength(5);
    expect(history).toHaveTextContent("release.tar");
    expect(history).toHaveTextContent("1분 5초");
    expect(screen.queryByLabelText("배포 실행 로그")).toBeNull();
    expect(callsTo(fetcher, "/deployments/d1")).toHaveLength(0);
    await user.click(
      within(history).getByRole("link", { name: "v1", exact: true }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("배포 실행 로그")).toHaveTextContent("done"),
    );
    expect(window.location.pathname).toBe("/demo/d1");
    expect(screen.queryByRole("table", { name: "배포 이력" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "설정", exact: true }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "새 배포" })).toBeNull();
    expect(screen.queryByLabelText("배포 파일 업로드")).toBeNull();
    const logDialog = screen.getByRole("alertdialog", { name: "실행 로그" });
    expect(within(logDialog).queryByText("v1", { exact: true })).toBeNull();
    expect(within(logDialog).getByText("완료", { exact: true })).toBeVisible();
    expect(
      within(logDialog).queryByText(/종료 코드|종료 \d|시작 \d/),
    ).toBeNull();
    fireEvent.pointerDown(
      document.querySelector('[data-slot="alert-dialog-overlay"]')!,
    );
    fireEvent.click(
      document.querySelector('[data-slot="alert-dialog-overlay"]')!,
    );
    expect(logDialog).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "모달 닫기", exact: true }),
    );
    await ready();
    expect(screen.queryByLabelText("배포 실행 로그")).toBeNull();
    expect(window.location.pathname).toBe("/demo");
    expect(screen.getByRole("link", { name: "v1", exact: true })).toHaveFocus();
    expect(callsTo(fetcher, "/deployments/d1")).toHaveLength(1);
  });
  test("deployment links and row clicks open log modals", async () => {
    const project = demo();
    project.deployments = [
      { ...deployment, status: "succeeded", startedAt: "2026-01-02" },
      { ...deployment, id: "d2", version: "v0", status: "failed" },
    ];
    const { data, fetcher, user } = fixture(true, [project]);
    data.intercept = (path) => {
      const selected = project.deployments.find((d) =>
        path.endsWith(`/deployments/${d.id}`),
      );
      return selected
        ? json({ deployment: selected, log: `log ${selected.version}` })
        : undefined;
    };
    await ready();
    expect(screen.queryByLabelText("배포 실행 로그")).toBeNull();
    expect(callsTo(fetcher, "/deployments/d1")).toHaveLength(0);
    expect(
      screen.getByRole("link", { name: "v1", exact: true }),
    ).toHaveAttribute("href", "/demo/d1");
    await user.click(screen.getByRole("link", { name: "v1", exact: true }));
    await waitFor(() =>
      expect(screen.getByLabelText("배포 실행 로그")).toHaveTextContent(
        "log v1",
      ),
    );
    await user.click(screen.getByRole("button", { name: "닫기", exact: true }));
    await screen.findByRole("table", { name: "배포 이력" });
    const row = screen
      .getByRole("link", { name: "v0", exact: true })
      .closest("tr")!;
    await user.click(within(row).getByRole("cell", { name: "release.tar" }));
    await waitFor(() =>
      expect(screen.getByLabelText("배포 실행 로그")).toHaveTextContent(
        "log v0",
      ),
    );
    expect(window.location.pathname).toBe("/demo/d2");
    expect(
      within(screen.getByRole("alertdialog", { name: "실행 로그" })).getByText(
        "실패",
        { exact: true },
      ),
    ).toBeVisible();
    expect(screen.queryByRole("table", { name: "배포 이력" })).toBeNull();
    expect(callsTo(fetcher, "/deployments/d2")).toHaveLength(1);
  });
  test("a deep log URL survives login and back/forward navigation", async () => {
    const project = demo();
    project.deployments = [{ ...deployment, status: "succeeded" }];
    const { data, user } = fixture(false, [project], "/demo/d1");
    data.status = "succeeded";
    await screen.findByLabelText("비밀번호");
    await user.type(screen.getByLabelText("사용자 이름"), "admin");
    await user.type(screen.getByLabelText("비밀번호"), "synthetic-password");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() =>
      expect(screen.getByLabelText("배포 실행 로그")).toHaveTextContent(
        "log output",
      ),
    );
    expect(window.location.pathname).toBe("/demo/d1");
    expect(screen.queryByRole("table", { name: "배포 이력" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "닫기", exact: true }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "닫기", exact: true }));
    await screen.findByRole("table", { name: "배포 이력" });
    expect(screen.queryByLabelText("배포 실행 로그")).toBeNull();
    expect(window.location.pathname).toBe("/demo");
    await user.click(screen.getByRole("link", { name: "v1", exact: true }));
    await screen.findByRole("alertdialog", { name: "실행 로그" });
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 30));
    });
    await screen.findByRole("table", { name: "배포 이력" });
    expect(window.location.pathname).toBe("/demo");
    expect(screen.queryByLabelText("배포 실행 로그")).toBeNull();
    await act(async () => {
      window.history.forward();
      await new Promise((r) => setTimeout(r, 30));
    });
    await waitFor(() =>
      expect(screen.getByLabelText("배포 실행 로그")).toHaveTextContent(
        "log output",
      ),
    );
    expect(window.location.pathname).toBe("/demo/d1");
  });
  test("a deployment from another project is not selected by a deep URL", async () => {
    const other = { ...demo(), id: "other", deployments: [deployment] };
    const { fetcher } = fixture(true, [demo(), other], "/demo/d1");
    await screen.findByText("존재하지 않거나 보관이 종료된 배포입니다.");
    expect(window.location.pathname).toBe("/demo/d1");
    expect(screen.queryByLabelText("배포 실행 로그")).toBeNull();
    expect(callsTo(fetcher, "/deployments/d1")).toHaveLength(0);
  });
  test("a log removed after listing shows a missing deployment instead of stale logs", async () => {
    const project = demo();
    project.deployments = [deployment];
    const { data, fetcher } = fixture(true, [project], "/demo/d1");
    data.intercept = (path) =>
      path.endsWith("/deployments/d1")
        ? json({ error: "Deployment not found" }, 404)
        : undefined;
    await screen.findByText("존재하지 않거나 보관이 종료된 배포입니다.");
    expect(screen.queryByLabelText("배포 실행 로그")).toBeNull();
    expect(callsTo(fetcher, "/deployments/d1")).toHaveLength(1);
  });
  test("a project request failure after login is visible", async () => {
    const { data, user } = fixture(false);
    data.intercept = (path) =>
      path === "/api/projects"
        ? json({ error: "Projects unavailable" }, 503)
        : undefined;
    await screen.findByLabelText("비밀번호");
    await user.type(screen.getByLabelText("사용자 이름"), "admin");
    await user.type(screen.getByLabelText("비밀번호"), "synthetic-password");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(await screen.findByText("Projects unavailable")).toHaveTextContent(
      "Projects unavailable",
    );
  });
  test("unauthenticated boot shows login and does not request project data", async () => {
    const { fetcher } = fixture(false);
    await screen.findByRole("heading", { name: "로그인" });
    expect(callsTo(fetcher, "/api/projects")).toHaveLength(0);
  });
  test("login prevents duplicate submissions and opens the workspace", async () => {
    const { data, fetcher, user } = fixture(false);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    data.intercept = (path) =>
      path === "/api/login"
        ? gate.then(() => {
            data.authenticated = true;
            return json({ ok: true });
          })
        : undefined;
    await screen.findByRole("heading", { name: "로그인" });
    await user.type(screen.getByLabelText("사용자 이름"), "admin");
    await user.type(screen.getByLabelText("비밀번호"), "synthetic-password");
    const form = document.getElementById("login-form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(callsTo(fetcher, "/api/login")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "로그인 중…" })).toBeDisabled();
    await act(async () => release());
    await ready();
  });
  test("failed login clears the password and presents the error", async () => {
    const { data, user } = fixture(false);
    data.intercept = (path) =>
      path === "/api/login" ? json({ error: "wrong" }, 401) : undefined;
    await screen.findByLabelText("비밀번호");
    await user.type(screen.getByLabelText("사용자 이름"), "admin");
    await user.type(screen.getByLabelText("비밀번호"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "사용자 이름 또는 비밀번호",
    );
    expect(screen.getByLabelText("비밀번호")).toHaveValue("");
  });
  test("upload sends raw file bytes, encoded filename and CSRF, then selects the result", async () => {
    const { fetcher, user } = fixture();
    await ready();
    await user.click(screen.getByRole("button", { name: "새 배포" }));
    const file = new File(["archive"], "배포 파일.tar");
    await user.upload(
      document.getElementById("artifact-file") as HTMLInputElement,
      file,
    );
    await user.click(
      screen.getByRole("button", { name: "업로드", exact: true }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("배포할 파일")).toHaveValue("a2"),
    );
    const init = callsTo(fetcher, "/artifacts")[0][1]!;
    expect(init.body).toBe(file);
    expect(new Headers(init.headers).get("X-Artifact-Name")).toBe(
      encodeURIComponent(file.name),
    );
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-fixture");
    expect(init.credentials).toBe("same-origin");
    expect(document.getElementById("artifact-file")).toHaveValue("");
  });
  test("file cancellation, multiple drops and oversized uploads are handled", async () => {
    fixture();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "새 배포" }));
    const fileInput = document.getElementById("artifact-file")!;
    fireEvent.change(fileInput, {
      target: { files: [new File(["small"], "one.tar")] },
    });
    fireEvent.change(fileInput, { target: { files: [] } });
    expect(
      screen.getByRole("button", { name: "업로드", exact: true }),
    ).toBeDisabled();
    fireEvent.drop(document.getElementById("drop-zone")!, {
      dataTransfer: { files: [new File([], "one"), new File([], "two")] },
    });
    expect(
      await screen.findByText("한 번에 파일 하나씩 업로드해 주세요", {
        selector: "[data-title]",
      }),
    ).toBeInTheDocument();
    const huge = new File([], "huge.tar");
    Object.defineProperty(huge, "size", { value: 2 * 1024 ** 3 });
    fireEvent.change(fileInput, { target: { files: [huge] } });
    expect(
      screen.getByRole("button", { name: "업로드", exact: true }),
    ).toBeDisabled();
    expect(screen.getByText(/파일 크기가 최대 1.0 GiB/)).toBeInTheDocument();
  });
  test("deploy sends selected artifact and version and renders logs as text", async () => {
    const { fetcher, user } = fixture();
    await ready();
    await user.click(screen.getByRole("button", { name: "새 배포" }));
    await user.type(screen.getByLabelText("버전"), "v2");
    await user.click(screen.getByRole("button", { name: /배포 시작/ }));
    await waitFor(() =>
      expect(screen.getByLabelText("배포 실행 로그")).toHaveTextContent(
        "<script>alert(1)</script>",
      ),
    );
    expect(
      screen.getByLabelText("배포 실행 로그").querySelector("script"),
    ).toBeNull();
    expect(JSON.parse(String(callsTo(fetcher, "/deploy")[0][1]!.body))).toEqual(
      { artifactId: "a1", version: "v2" },
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.location.pathname).toBe("/demo/d1");
    expect(screen.queryByRole("table", { name: "배포 이력" })).toBeNull();
  });
  test("deployment input lives in a dismissible modal and a failed request preserves the draft", async () => {
    const { data, user } = fixture();
    await ready();
    expect(screen.queryByLabelText("버전")).toBeNull();
    const trigger = screen.getByRole("button", { name: "새 배포" });
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "모달 닫기" })).toBeVisible();
    await user.type(screen.getByLabelText("버전"), "v-draft");
    data.intercept = (path) =>
      path.endsWith("/deploy")
        ? json({ error: "Deployment unavailable" }, 409)
        : undefined;
    await user.click(screen.getByRole("button", { name: "배포 시작" }));
    expect(
      await within(screen.getByRole("dialog")).findByText(
        "Deployment unavailable",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("버전")).toHaveValue("v-draft");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    expect(screen.getByLabelText("버전")).toHaveValue("v-draft");
  });
  test("running logs pause when hidden, resume, then stop at a terminal state", async () => {
    const project = demo();
    project.deployments = [deployment];
    project.running = "d1";
    const { data, fetcher, user } = fixture(true, [project]);
    await ready();
    expect(screen.queryByLabelText("배포 실행 로그")).toBeNull();
    expect(callsTo(fetcher, "/deployments/d1")).toHaveLength(0);
    await user.click(screen.getByRole("link", { name: "v1", exact: true }));
    await waitFor(() =>
      expect(callsTo(fetcher, "/deployments/d1")).toHaveLength(1),
    );
    let hidden = true;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2100));
    });
    expect(callsTo(fetcher, "/deployments/d1")).toHaveLength(1);
    data.status = "succeeded";
    data.projects[0].deployments = [{ ...deployment, status: "succeeded" }];
    data.projects[0].running = null;
    hidden = false;
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() =>
      expect(callsTo(fetcher, "/deployments/d1")).toHaveLength(2),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2100));
    });
    expect(callsTo(fetcher, "/deployments/d1")).toHaveLength(2);
    expect(document.getElementById("cancel-button")).toBeNull();
  }, 10000);
  test("the header replaces new deployment with cancellation without opening logs", async () => {
    const project = demo();
    project.deployments = [deployment];
    project.running = "d1";
    const { data, fetcher, user } = fixture(true, [project]);
    let finish!: () => void;
    data.intercept = (path) => {
      if (!path.endsWith("/cancel")) return;
      // Cancellation is acknowledged before the process actually exits.
      finish = () => {
        data.projects[0].deployments = [{ ...deployment, status: "cancelled" }];
        data.projects[0].running = null;
      };
      return json({ ok: true });
    };
    await ready();
    expect(screen.queryByRole("button", { name: "새 배포" })).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "실행 취소" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "실행 취소" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "실행 취소" })).toBeEnabled(),
    );
    expect(screen.queryByRole("button", { name: "새 배포" })).toBeNull();
    finish();
    await waitFor(
      () =>
        expect(screen.getByRole("button", { name: "새 배포" })).toBeEnabled(),
      { timeout: 4000 },
    );
    expect(document.getElementById("cancel-button")).toBeNull();
    expect(callsTo(fetcher, "/deployments/d1/cancel")).toHaveLength(1);
    expect(callsTo(fetcher, "/deployments/d1")).toHaveLength(0);
    expect(window.location.pathname).toBe("/demo");
    expect(
      new Headers(callsTo(fetcher, "/cancel")[0][1]!.headers).get(
        "X-CSRF-Token",
      ),
    ).toBe("csrf-fixture");
  });
  test("logs have no cancellation button and cancellation targets the active deployment", async () => {
    const project = demo();
    project.deployments = [
      deployment,
      { ...deployment, id: "old", version: "v0", status: "succeeded" },
    ];
    // The deployment status also identifies the active run if running is absent.
    const { data, fetcher, user } = fixture(true, [project]);
    data.intercept = (path) =>
      path.endsWith("/deployments/old")
        ? json({ deployment: project.deployments[1], log: "previous run" })
        : undefined;
    await ready();
    await user.click(screen.getByRole("link", { name: "v0", exact: true }));
    const logs = await screen.findByRole("alertdialog", { name: /실행 로그/ });
    expect(
      within(logs).queryByRole("button", { name: "실행 취소" }),
    ).toBeNull();
    await user.click(
      within(logs).getByRole("button", { name: "닫기", exact: true }),
    );
    await user.click(screen.getByRole("button", { name: "실행 취소" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "새 배포" })).toBeEnabled(),
    );
    expect(callsTo(fetcher, "/deployments/d1/cancel")).toHaveLength(1);
    expect(callsTo(fetcher, "/deployments/old/cancel")).toHaveLength(0);
  });
  test("project switching discards a late log response and clears the selected file", async () => {
    const first = demo();
    first.deployments = [deployment];
    first.running = "d1";
    const second = { ...demo(), id: "second", name: "Second" };
    const { data, user, fetcher } = fixture(true, [first, second]);
    let release!: (response: Response) => void;
    data.intercept = (path) =>
      path.includes("/deployments/")
        ? new Promise((resolve) => {
            release = resolve;
          })
        : undefined;
    await ready();
    await user.click(screen.getByRole("link", { name: "v1", exact: true }));
    await waitFor(() =>
      expect(callsTo(fetcher, "/deployments/d1")).toHaveLength(1),
    );
    await user.click(screen.getByRole("button", { name: "닫기", exact: true }));
    await screen.findByRole("table", { name: "배포 이력" });
    await user.click(screen.getByRole("link", { name: "프로젝트 목록" }));
    await user.click(await screen.findByRole("link", { name: /Second/ }));
    await screen.findByRole("heading", { name: "Second", level: 1 });
    await act(async () => release(json({ deployment, log: "stale response" })));
    expect(screen.queryByLabelText("배포 실행 로그")).toBeNull();
    expect(screen.queryByText("실행 로그를 불러오는 중…")).toBeNull();
  });
  test("an empty workspace supports project registration and editing", async () => {
    const { fetcher, user } = fixture(true, []);
    await screen.findByText("아직 프로젝트가 없습니다");
    expect(
      within(screen.getByRole("table", { name: "프로젝트 목록" })).getByRole(
        "cell",
      ),
    ).toHaveAttribute("colspan", "6");
    await user.click(screen.getByRole("button", { name: "등록" }));
    expect(screen.queryByLabelText("프로젝트 ID")).toBeNull();
    await user.type(screen.getByLabelText("프로젝트 이름"), "New project");
    await user.clear(screen.getByLabelText("배포 스크립트"));
    await user.type(
      screen.getByLabelText("배포 스크립트"),
      "#!/bin/sh\necho deployed",
    );
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByRole("heading", { name: "New project", level: 1 });
    expect(window.location.pathname).toBe("/generated-id");
    expect(
      await screen.findByText("프로젝트를 등록했어요", {
        selector: "[data-title]",
      }),
    ).toBeInTheDocument();
    const created = fetcher.mock.calls.find(
      ([path, init]) => path === "/api/projects" && init?.method === "POST",
    )!;
    expect(JSON.parse(String(created[1]?.body))).toEqual({
      name: "New project",
      scriptContent: "#!/bin/sh\necho deployed",
      timeoutSeconds: 300,
    });
    await user.click(screen.getByRole("button", { name: "설정", exact: true }));
    expect(screen.queryByLabelText("프로젝트 ID")).toBeNull();
    await waitFor(() =>
      expect(screen.getByLabelText("배포 스크립트")).toHaveValue(
        "#!/bin/sh\necho existing\n",
      ),
    );
    await user.clear(screen.getByLabelText("프로젝트 이름"));
    await user.type(screen.getByLabelText("프로젝트 이름"), "Updated");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByRole("heading", { name: "Updated", level: 1 });
    expect(
      fetcher.mock.calls.some(
        ([path, init]) =>
          path === "/api/projects/generated-id" && init?.method === "PUT",
      ),
    ).toBe(true);
  });
  test("project removal requires confirmation and returns to the project list", async () => {
    const { fetcher, user } = fixture(true, [
      demo(),
      { ...demo(), id: "second", name: "Second" },
    ]);
    await ready();
    await user.click(
      screen.getByRole("button", { name: "프로젝트 삭제", exact: true }),
    );
    expect(
      fetcher.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
    expect(
      screen.getByRole("alertdialog", { name: "프로젝트 삭제 확인" }),
    ).toHaveTextContent("복구할 수 없습니다");
    await user.click(
      within(
        screen.getByRole("alertdialog", { name: "프로젝트 삭제 확인" }),
      ).getByRole("button", { name: "프로젝트 삭제" }),
    );
    await screen.findByRole("link", { name: /Second/ });
    expect(window.location.pathname).toBe("/");
  });
  test("scripts load only when editing, and failed reads cannot overwrite the file", async () => {
    const { data, fetcher, user } = fixture();
    await ready();
    expect(callsTo(fetcher, "/script")).toHaveLength(0);
    data.intercept = (path) =>
      path.endsWith("/script")
        ? json({ error: "Script unavailable" }, 400)
        : undefined;
    await user.click(screen.getByRole("button", { name: "설정", exact: true }));
    expect(await screen.findByText("Script unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    expect(screen.getByLabelText("배포 스크립트")).toBeDisabled();
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(
      false,
    );
    await user.click(screen.getByRole("button", { name: "닫기" }));
    data.intercept = undefined;
    await user.click(screen.getByRole("button", { name: "설정", exact: true }));
    await waitFor(() =>
      expect(screen.getByLabelText("배포 스크립트")).toHaveValue(
        "#!/bin/sh\necho existing\n",
      ),
    );
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
  });
  test("project management respects server busy state and keeps failed edits open", async () => {
    const { data, user } = fixture();
    await ready();
    await user.click(screen.getByRole("button", { name: "설정", exact: true }));
    data.intercept = (_, init) =>
      init.method === "PUT"
        ? json({ error: "Script missing" }, 400)
        : undefined;
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(
      await within(screen.getByRole("dialog")).findByText("Script missing"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("프로젝트 이름")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "닫기" }));
    data.managementBusy = true;
    await user.click(screen.getByRole("link", { name: "프로젝트 목록" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "등록" })).toBeDisabled(),
    );
  });
  test("dialogs support keyboard dismissal, restore focus and cancel without deleting", async () => {
    const { user, fetcher } = fixture();
    await ready();
    const settings = screen.getByRole("button", { name: "설정", exact: true });
    await user.click(settings);
    expect(screen.getByLabelText("프로젝트 이름")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "모달 닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(settings).toHaveFocus();
    await user.click(settings);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(settings).toHaveFocus();
    const remove = screen.getByRole("button", {
      name: "프로젝트 삭제",
      exact: true,
    });
    await user.click(remove);
    const cancel = screen.getByRole("button", { name: "취소" });
    expect(cancel).toHaveFocus();
    await user.click(cancel);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(remove).toHaveFocus();
    await user.click(remove);
    await user.click(screen.getByRole("button", { name: "모달 닫기" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(remove).toHaveFocus();
    expect(
      fetcher.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
  });
  test("session expiry clears the workspace and logout uses the API", async () => {
    const { data, user } = fixture();
    await ready();
    data.authenticated = false;
    await user.click(screen.getByRole("link", { name: "프로젝트 목록" }));
    await screen.findByRole("heading", { name: "로그인" });
    expect(screen.getByRole("alert")).toHaveTextContent("세션이 만료");
  });
  test("logout clears project and session state", async () => {
    const { fetcher, user } = fixture();
    await ready();
    await user.click(screen.getByRole("button", { name: "로그아웃" }));
    await screen.findByRole("heading", { name: "로그인" });
    expect(
      new Headers(callsTo(fetcher, "/api/logout")[0][1]!.headers).get(
        "X-CSRF-Token",
      ),
    ).toBe("csrf-fixture");
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
