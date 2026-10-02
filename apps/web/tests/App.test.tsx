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
function fixture(authenticated = true, initialProjects = [demo()]) {
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
        data.projects.push({
          ...inputBody,
          artifacts: [],
          deployments: [],
          running: null,
        });
        return json({ project: inputBody }, 201);
      }
      if (method === "PUT") {
        Object.assign(
          data.projects.find((p) => path.endsWith(p.id))!,
          JSON.parse(String(init.body)),
        );
        return json({ ok: true });
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
  test("a project request failure after login is visible and refresh can recover", async () => {
    const { data, user } = fixture(false);
    data.intercept = (path) =>
      path === "/api/projects"
        ? json({ error: "Projects unavailable" }, 503)
        : undefined;
    await screen.findByLabelText("비밀번호");
    await user.type(screen.getByLabelText("사용자 이름"), "admin");
    await user.type(screen.getByLabelText("비밀번호"), "synthetic-password");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Projects unavailable",
    );
    data.intercept = undefined;
    await user.click(screen.getByRole("button", { name: /새로고침/ }));
    await ready();
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
    expect(screen.getByRole("status")).toHaveTextContent("파일 하나씩");
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
  });
  test("running logs pause when hidden, resume, then stop at a terminal state", async () => {
    const project = demo();
    project.deployments = [deployment];
    project.running = "d1";
    const { data, fetcher } = fixture(true, [project]);
    await ready();
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
  test("cancellation uses CSRF and updates the deployment state", async () => {
    const project = demo();
    project.deployments = [deployment];
    project.running = "d1";
    const { fetcher, user } = fixture(true, [project]);
    await ready();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "실행 취소" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "실행 취소" }));
    await waitFor(() =>
      expect(document.getElementById("cancel-button")).toBeNull(),
    );
    expect(
      new Headers(callsTo(fetcher, "/cancel")[0][1]!.headers).get(
        "X-CSRF-Token",
      ),
    ).toBe("csrf-fixture");
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
    await waitFor(() =>
      expect(callsTo(fetcher, "/deployments/d1")).toHaveLength(1),
    );
    await user.click(
      within(
        screen.getByRole("navigation", { name: "프로젝트 선택" }),
      ).getByRole("button", { name: "Second" }),
    );
    await screen.findByRole("heading", { name: "Second", level: 1 });
    await act(async () => release(json({ deployment, log: "stale response" })));
    expect(screen.getByLabelText("배포 실행 로그")).not.toHaveTextContent(
      "stale response",
    );
    expect(screen.queryByText("실행 로그를 불러오는 중…")).toBeNull();
  });
  test("an empty workspace supports project registration and editing", async () => {
    const { fetcher, user } = fixture(true, []);
    await screen.findByText("아직 프로젝트가 없습니다");
    await user.click(screen.getByRole("button", { name: "등록" }));
    await user.type(screen.getByLabelText("프로젝트 ID"), "new");
    await user.type(screen.getByLabelText("프로젝트 이름"), "New project");
    await user.type(
      screen.getByLabelText("서버의 배포 스크립트 경로"),
      "/trusted/new.sh",
    );
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByRole("heading", { name: "New project", level: 1 });
    await user.click(screen.getByRole("button", { name: "설정", exact: true }));
    expect(screen.getByLabelText("프로젝트 ID")).toHaveAttribute("readonly");
    await user.clear(screen.getByLabelText("프로젝트 이름"));
    await user.type(screen.getByLabelText("프로젝트 이름"), "Updated");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByRole("heading", { name: "Updated", level: 1 });
    expect(
      fetcher.mock.calls.some(
        ([path, init]) =>
          path === "/api/projects/new" && init?.method === "PUT",
      ),
    ).toBe(true);
  });
  test("project removal requires confirmation and selects the next project", async () => {
    const { fetcher, user } = fixture(true, [
      demo(),
      { ...demo(), id: "second", name: "Second" },
    ]);
    await ready();
    await user.click(
      screen.getByRole("button", { name: "등록 해제", exact: true }),
    );
    expect(
      fetcher.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
    await user.click(
      within(
        screen.getByRole("alertdialog", { name: "프로젝트 등록 해제 확인" }),
      ).getByRole("button", { name: "등록 해제" }),
    );
    await screen.findByRole("heading", { name: "Second", level: 1 });
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
    await user.click(screen.getByRole("button", { name: /새로고침/ }));
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
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(settings).toHaveFocus();
    const remove = screen.getByRole("button", {
      name: "등록 해제",
      exact: true,
    });
    await user.click(remove);
    const cancel = screen.getByRole("button", { name: "취소" });
    expect(cancel).toHaveFocus();
    await user.click(cancel);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(remove).toHaveFocus();
    expect(
      fetcher.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
  });
  test("session expiry clears the workspace and logout uses the API", async () => {
    const { data, user } = fixture();
    await ready();
    data.authenticated = false;
    await user.click(screen.getByRole("button", { name: /새로고침/ }));
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
