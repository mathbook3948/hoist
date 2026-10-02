import { expect, test, vi } from "vitest";
import { APIError, requestJSON } from "../src/api";

test("API transport preserves JSON, raw uploads, credentials, headers and abort signals", async () => {
  const fetcher = vi.fn(async () => new Response('{"ok":true}'));
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  const headers = new Headers({ "X-Custom": "kept" });
  expect(
    await requestJSON("/api/projects", "token", {
      method: "POST",
      headers,
      json: { name: "demo" },
      signal,
    }),
  ).toEqual({ ok: true });
  const sent = vi.mocked(fetch).mock.calls[0][1]!;
  expect(sent.credentials).toBe("same-origin");
  expect(sent.signal).toBe(signal);
  expect(sent.body).toBe('{"name":"demo"}');
  expect(Object.fromEntries(new Headers(sent.headers))).toEqual({
    "content-type": "application/json",
    "x-csrf-token": "token",
    "x-custom": "kept",
  });
  expect(headers.has("X-CSRF-Token")).toBe(false);

  const file = new File(["archive"], "release.tar");
  await requestJSON("/api/projects/demo/artifacts", "token", {
    method: "POST",
    body: file,
    headers: { "Content-Type": "application/octet-stream" },
  });
  const upload = vi.mocked(fetch).mock.calls[1][1]!;
  expect(upload.body).toBe(file);
  expect(new Headers(upload.headers).get("Content-Type")).toBe(
    "application/octet-stream",
  );

  await requestJSON("/api/me", "token");
  expect(
    new Headers(vi.mocked(fetch).mock.calls[2][1]!.headers).has("X-CSRF-Token"),
  ).toBe(false);
});

test("API transport retains status errors and non-JSON response fallback", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockResolvedValueOnce(
    new Response('{"error":"Login required"}', { status: 401 }),
  );
  await expect(requestJSON("/api/me", "")).rejects.toMatchObject({
    message: "Login required",
    status: 401,
  });
  fetcher.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
  await expect(requestJSON("/api/me", "")).rejects.toEqual(
    new APIError("요청을 완료하지 못했습니다 (503)", 503),
  );
  fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(requestJSON("/api/logout", "")).resolves.toEqual({});

  const failure = new TypeError("Failed to fetch");
  fetcher.mockRejectedValueOnce(failure);
  await expect(requestJSON("/api/me", "")).rejects.toBe(failure);
});
