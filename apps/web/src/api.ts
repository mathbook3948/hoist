export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export const describeError = (error: unknown) =>
  error instanceof TypeError
    ? "서버에 연결할 수 없습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요"
    : error instanceof Error
      ? error.message
      : "요청을 완료하지 못했습니다";
export type RequestOptions = RequestInit & { json?: unknown };

export async function requestJSON<T>(
  path: string,
  csrf: string,
  options: RequestOptions = {},
): Promise<T> {
  const { json, ...init } = options;
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET") headers.set("X-CSRF-Token", csrf);
  if (json !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
    body: json !== undefined ? JSON.stringify(json) : init.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new APIError(
      data.error || `요청을 완료하지 못했습니다 (${response.status})`,
      response.status,
    );
  return data as T;
}
