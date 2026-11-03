import type { User } from "../shared/types";
import { cookie, Env, HttpError, isSecure, json, parseCookies, randomId, sha256 } from "./util";

const SESSION_COOKIE = "sid";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

export function providers(env: Env) {
  return {
    github: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    dev: env.DEV_LOGIN === "true",
  };
}

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  provider: string;
}

export async function getUser(req: Request, env: Env): Promise<User | null> {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const sid = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.avatar_url, u.provider
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(sid, Date.now())
    .first<UserRow>();
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, avatar: row.avatar_url, provider: row.provider };
}

export async function requireUser(req: Request, env: Env): Promise<User> {
  const u = await getUser(req, env);
  if (!u) throw new HttpError(401, "Login required");
  return u;
}

function safeReturn(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return "/";
  return path;
}

async function upsertUser(
  env: Env,
  p: { provider: string; providerId: string; name: string; email: string | null; avatar: string | null },
): Promise<string> {
  const row = await env.DB.prepare(
    `INSERT INTO users (id, provider, provider_id, name, email, avatar_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider, provider_id) DO UPDATE SET
       name = excluded.name, email = excluded.email, avatar_url = excluded.avatar_url
     RETURNING id`,
  )
    .bind(randomId(), p.provider, p.providerId, p.name, p.email, p.avatar, Date.now())
    .first<{ id: string }>();
  if (!row) throw new HttpError(500, "Could not create user");
  return row.id;
}

async function startSession(env: Env, url: URL, userId: string, returnTo: string): Promise<Response> {
  const token = randomId(32);
  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, Date.now() + SESSION_TTL * 1000)
    .run();
  // opportunistic cleanup of expired sessions
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()).run();
  const h = new Headers({ location: safeReturn(returnTo) });
  const secure = isSecure(url);
  h.append("set-cookie", cookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL, secure }));
  h.append("set-cookie", cookie("oauth_state", "", { maxAge: 0, secure }));
  h.append("set-cookie", cookie("oauth_return", "", { maxAge: 0, secure }));
  return new Response(null, { status: 302, headers: h });
}

function beginOAuth(url: URL, authorizeUrl: string): Response {
  const state = randomId(16);
  const target = new URL(authorizeUrl);
  target.searchParams.set("state", state);
  const h = new Headers({ location: target.toString() });
  const secure = isSecure(url);
  h.append("set-cookie", cookie("oauth_state", state, { maxAge: 600, secure }));
  h.append("set-cookie", cookie("oauth_return", safeReturn(url.searchParams.get("return")), { maxAge: 600, secure }));
  return new Response(null, { status: 302, headers: h });
}

function checkState(req: Request, url: URL) {
  const c = parseCookies(req);
  const state = url.searchParams.get("state");
  if (!state || !c.oauth_state || state !== c.oauth_state) throw new HttpError(400, "OAuth state mismatch. 다시 로그인해 주세요.");
  const code = url.searchParams.get("code");
  if (!code) throw new HttpError(400, url.searchParams.get("error_description") || "Missing code");
  return { code, returnTo: c.oauth_return || "/" };
}

export async function handleAuth(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const p = providers(env);
  const origin = url.origin;

  // ---- GitHub ----
  if (path === "/auth/github") {
    if (!p.github) throw new HttpError(404, "GitHub login is not configured");
    const a = new URL("https://github.com/login/oauth/authorize");
    a.searchParams.set("client_id", env.GITHUB_CLIENT_ID!);
    a.searchParams.set("redirect_uri", `${origin}/auth/github/callback`);
    a.searchParams.set("scope", "read:user user:email");
    return beginOAuth(url, a.toString());
  }
  if (path === "/auth/github/callback") {
    if (!p.github) throw new HttpError(404, "GitHub login is not configured");
    const { code, returnTo } = checkState(req, url);
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${origin}/auth/github/callback`,
      }),
    });
    const tok = (await tokenRes.json()) as { access_token?: string; error_description?: string };
    if (!tok.access_token) throw new HttpError(400, tok.error_description || "GitHub token exchange failed");
    const gh = { authorization: `Bearer ${tok.access_token}`, "user-agent": "inkboard", accept: "application/vnd.github+json" };
    const u = (await (await fetch("https://api.github.com/user", { headers: gh })).json()) as {
      id: number; login: string; name: string | null; email: string | null; avatar_url: string;
    };
    if (!u?.id) throw new HttpError(400, "Could not read GitHub profile");
    let email = u.email;
    if (!email) {
      const emails = (await (await fetch("https://api.github.com/user/emails", { headers: gh })).json().catch(() => [])) as {
        email: string; primary: boolean; verified: boolean;
      }[];
      email = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified)?.email ?? null : null;
    }
    const id = await upsertUser(env, {
      provider: "github", providerId: String(u.id), name: u.name || u.login, email, avatar: u.avatar_url,
    });
    return startSession(env, url, id, returnTo);
  }

  // ---- Google ----
  if (path === "/auth/google") {
    if (!p.google) throw new HttpError(404, "Google login is not configured");
    const a = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    a.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
    a.searchParams.set("redirect_uri", `${origin}/auth/google/callback`);
    a.searchParams.set("response_type", "code");
    a.searchParams.set("scope", "openid email profile");
    a.searchParams.set("prompt", "select_account");
    return beginOAuth(url, a.toString());
  }
  if (path === "/auth/google/callback") {
    if (!p.google) throw new HttpError(404, "Google login is not configured");
    const { code, returnTo } = checkState(req, url);
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${origin}/auth/google/callback`,
      }),
    });
    const tok = (await tokenRes.json()) as { access_token?: string; error_description?: string };
    if (!tok.access_token) throw new HttpError(400, tok.error_description || "Google token exchange failed");
    const u = (await (
      await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${tok.access_token}` },
      })
    ).json()) as { sub: string; name?: string; email?: string; picture?: string };
    if (!u?.sub) throw new HttpError(400, "Could not read Google profile");
    const id = await upsertUser(env, {
      provider: "google", providerId: u.sub, name: u.name || u.email || "Google user",
      email: u.email ?? null, avatar: u.picture ?? null,
    });
    return startSession(env, url, id, returnTo);
  }

  // ---- Dev login (local only) ----
  if (path === "/auth/dev") {
    if (!p.dev) throw new HttpError(404, "Dev login is disabled");
    const name = (url.searchParams.get("name") || "").trim().slice(0, 40) || "Guest";
    const id = await upsertUser(env, {
      provider: "dev", providerId: name.toLowerCase(), name, email: null, avatar: null,
    });
    return startSession(env, url, id, url.searchParams.get("return") || "/");
  }

  if (path === "/auth/logout") {
    if (req.method !== "POST") throw new HttpError(405, "Use POST");
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
    return json({ ok: true }, 200, { "set-cookie": cookie(SESSION_COOKIE, "", { maxAge: 0, secure: isSecure(url) }) });
  }

  throw new HttpError(404, "Not found");
}
