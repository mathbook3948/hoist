import { randomBytes } from "node:crypto";
import type { Config, Store } from "./store";
import { fail, json, smallJSON } from "./http";

const token = () => randomBytes(32).toString("hex");
const COOKIE_PREFIX = "hoist_session=";
const sessionToken = (req: Request) =>
  (req.headers.get("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(COOKIE_PREFIX))
    ?.slice(COOKIE_PREFIX.length);

// Fixed work factor for unknown users too; no valid account uses this hash.
const dummyHash =
  "$2b$12$TSS.fGeGXRFHYIA9/xLE5ODDaSPtSLFK.AxMgCpSQOXrEG0k.tNYu";

export function createAuth(store: Store, config: Config, origin: string) {
  const sessions = new Map<
    string,
    { username: string; csrf: string; expires: number }
  >();
  const attempts = new Map<string, { count: number; until: number }>();
  let verifying = false;
  const cookie = (v: string, clear = false) =>
    `${COOKIE_PREFIX}${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : config.sessionHours * 3600}${config.publicOrigin ? "; Secure" : ""}`;
  const getSession = (req: Request) => {
    const v = sessionToken(req);
    const s = v ? sessions.get(v) : undefined;
    if (!s || s.expires < Date.now()) {
      if (v) sessions.delete(v);
      fail(401, "Login required");
    }
    return s;
  };
  function sameOrigin(req: Request) {
    if (req.headers.get("origin") !== origin) fail(403, "Origin rejected");
  }
  function csrf(req: Request) {
    sameOrigin(req);
    const s = getSession(req);
    if (req.headers.get("x-csrf-token") !== s.csrf)
      fail(403, "CSRF token rejected");
    return s;
  }

  async function login(req: Request, ip: string) {
    sameOrigin(req);
    const now = Date.now();
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    const prior = attempts.get(ip);
    if (prior && prior.count >= 10)
      fail(429, "Too many attempts; retry in 15 minutes");
    if (verifying) fail(429, "Login busy; retry shortly");
    if (!prior && attempts.size >= 1024) fail(429, "Login capacity reached");
    // Reserve before reading any body: only one bounded parser/bcrypt worker can run.
    verifying = true;
    attempts.set(ip, {
      count: (prior?.count || 0) + 1,
      until: prior?.until || now + 15 * 60 * 1000,
    });
    let ok = false;
    let body: any;
    try {
      body = await smallJSON(req);
      if (
        typeof body.username !== "string" ||
        body.username.length > 64 ||
        typeof body.password !== "string" ||
        Buffer.byteLength(body.password, "utf8") > 72
      )
        fail(400, "Invalid credentials");
      const account = store.getAccount();
      const a = account?.username === body.username ? account : null;
      const verified = await Bun.password.verify(
        body.password,
        a?.passwordHash || dummyHash,
      );
      ok = Boolean(a) && verified;
    } finally {
      verifying = false;
    }
    if (!ok) fail(401, "Invalid credentials");
    attempts.delete(ip);
    for (const [k, s] of sessions) if (s.expires < now) sessions.delete(k);
    if (sessions.size >= 128) fail(429, "Session capacity reached");
    const id = token();
    const s = {
      username: body.username,
      csrf: token(),
      expires: now + config.sessionHours * 3600 * 1000,
    };
    sessions.set(id, s);
    return json({ username: s.username, csrf: s.csrf }, 200, {
      "Set-Cookie": cookie(id),
    });
  }

  function me(req: Request) {
    const s = getSession(req);
    return json({ username: s.username, csrf: s.csrf });
  }

  function logout(req: Request) {
    csrf(req);
    const v = sessionToken(req);
    if (v) sessions.delete(v);
    return json({ ok: true }, 200, { "Set-Cookie": cookie("", true) });
  }

  return { login, me, logout, getSession, csrf };
}
