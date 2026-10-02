import { state } from "./state.js";

export function createAPI(onSessionExpired) {
  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== "GET")
      headers.set("X-CSRF-Token", state.csrf);
    if (options.json !== undefined)
      headers.set("Content-Type", "application/json");
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers,
      body:
        options.json !== undefined
          ? JSON.stringify(options.json)
          : options.body,
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      /* Empty success responses are allowed. */
    }
    if (!response.ok) {
      if (response.status === 401 && path !== "/api/login") {
        onSessionExpired();
      }
      const error = new Error(
        data?.error || `요청을 완료하지 못했습니다 (${response.status})`,
      );
      error.status = response.status;
      throw error;
    }
    return data || {};
  }

  return api;
}

export function describeError(error) {
  return error instanceof TypeError
    ? "서버에 연결할 수 없습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요"
    : error.message || "요청을 완료하지 못했습니다";
}
