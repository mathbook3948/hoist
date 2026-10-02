export class HTTPError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (status: number, message: string): never => {
  throw new HTTPError(status, message);
};
export const security = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Cache-Control": "no-store",
};
export function json(
  value: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return Response.json(value, { status, headers: { ...security, ...extra } });
}
export async function smallJSON(req: Request) {
  if (!(req.headers.get("content-type") || "").startsWith("application/json"))
    fail(415, "JSON content type required");
  if (!req.body) fail(400, "Body required");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0,
    timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 10000);
  try {
    while (true) {
      const r = await reader.read();
      if (timedOut) fail(408, "JSON body deadline exceeded");
      if (r.done) break;
      total += r.value.length;
      if (total > 8192) fail(413, "Request too large");
      chunks.push(r.value);
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      fail(400, "Invalid JSON");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(400, "JSON object required");
    return value as Record<string, any>;
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    clearTimeout(deadline);
  }
}
