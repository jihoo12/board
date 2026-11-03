import type { BoardMeta, BoardSummary, El, ShareMode, User } from "../shared/types";
import { getUser, handleAuth, providers, requireUser } from "./auth";
import { BoardRoom } from "./room";
import { Env, HttpError, json, randomId, readJson } from "./util";

export { BoardRoom };

interface BoardRow {
  id: string;
  owner_id: string;
  title: string;
  share: ShareMode;
  thumbnail: string | null;
  updated_at: number;
}

const MAX_ASSET_BYTES = 1_900_000; // D1 row limit is 2MB

async function loadBoard(env: Env, id: string) {
  const b = await env.DB.prepare(
    `SELECT b.id, b.owner_id, b.title, b.share, b.thumbnail, b.updated_at, u.name AS owner_name, u.avatar_url AS owner_avatar
       FROM boards b JOIN users u ON u.id = b.owner_id WHERE b.id = ?`,
  )
    .bind(id)
    .first<BoardRow & { owner_name: string; owner_avatar: string | null }>();
  if (!b) throw new HttpError(404, "보드를 찾을 수 없어요");
  return b;
}

function access(b: BoardRow, user: User | null) {
  const isOwner = !!user && user.id === b.owner_id;
  const canEdit = isOwner || (!!user && b.share === "edit");
  const canView = canEdit || b.share === "view" || b.share === "edit";
  return { isOwner, canEdit, canView };
}

function roomStub(env: Env, boardId: string) {
  return env.ROOM.get(env.ROOM.idFromName(boardId));
}

function sanitizeElements(input: unknown): El[] {
  if (!Array.isArray(input)) return [];
  return input.filter((e) => e && typeof e === "object" && typeof e.id === "string" && typeof e.type === "string") as El[];
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  // CSRF / cross-site WebSocket hijacking guard: browsers always send Origin on these requests
  const origin = req.headers.get("origin");
  const mutating = method !== "GET" && method !== "HEAD";
  const isWs = req.headers.get("upgrade")?.toLowerCase() === "websocket";
  if ((mutating || isWs) && origin && origin !== url.origin) throw new HttpError(403, "Cross-origin request blocked");

  if (path === "/api/me" && method === "GET") {
    return json({ user: await getUser(req, env), providers: providers(env) });
  }

  if (path === "/api/boards" && method === "GET") {
    const user = await requireUser(req, env);
    const owned = await env.DB.prepare(
      `SELECT id, title, thumbnail, share, updated_at FROM boards WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 200`,
    )
      .bind(user.id)
      .all<BoardRow>();
    const shared = await env.DB.prepare(
      `SELECT b.id, b.title, b.thumbnail, b.share, b.updated_at, u.name AS owner_name
         FROM board_visits v JOIN boards b ON b.id = v.board_id JOIN users u ON u.id = b.owner_id
        WHERE v.user_id = ? AND b.owner_id != ? AND b.share != 'private'
        ORDER BY v.visited_at DESC LIMIT 50`,
    )
      .bind(user.id, user.id)
      .all<BoardRow & { owner_name: string }>();
    const map = (r: BoardRow & { owner_name?: string }): BoardSummary => ({
      id: r.id, title: r.title, thumbnail: r.thumbnail, share: r.share, updatedAt: r.updated_at, ownerName: r.owner_name,
    });
    return json({ owned: owned.results.map(map), shared: shared.results.map(map) });
  }

  if (path === "/api/boards" && method === "POST") {
    const user = await requireUser(req, env);
    const body = await readJson<{ title?: string; elements?: unknown }>(req);
    const id = randomId(9);
    const now = Date.now();
    const title = (body.title || "").trim().slice(0, 120) || "제목 없는 보드";
    const elements = sanitizeElements(body.elements);
    await env.DB.prepare(
      `INSERT INTO boards (id, owner_id, title, data, share, created_at, updated_at) VALUES (?, ?, ?, ?, 'private', ?, ?)`,
    )
      .bind(id, user.id, title, JSON.stringify(elements), now, now)
      .run();
    return json({ id }, 201);
  }

  const m = path.match(/^\/api\/boards\/([A-Za-z0-9_-]+)(\/[a-z]+)?$/);
  if (m) {
    const boardId = m[1];
    const sub = m[2] || "";
    const user = await getUser(req, env);
    const b = await loadBoard(env, boardId);
    const acc = access(b, user);
    if (!acc.canView) throw new HttpError(user ? 403 : 401, user ? "이 보드에 접근할 권한이 없어요" : "Login required");

    if (sub === "" && method === "GET") {
      if (user && !acc.isOwner) {
        await env.DB.prepare(
          `INSERT INTO board_visits (user_id, board_id, visited_at) VALUES (?, ?, ?)
           ON CONFLICT (user_id, board_id) DO UPDATE SET visited_at = excluded.visited_at`,
        )
          .bind(user.id, boardId, Date.now())
          .run();
      }
      const meta: BoardMeta = {
        id: b.id, title: b.title, share: b.share, isOwner: acc.isOwner, canEdit: acc.canEdit,
        owner: { name: b.owner_name, avatar: b.owner_avatar },
      };
      return json(meta);
    }

    if (sub === "" && method === "PATCH") {
      if (!acc.canEdit) throw new HttpError(403, "편집 권한이 없어요");
      const body = await readJson<{ title?: string; share?: ShareMode }>(req);
      if (body.title !== undefined) {
        const t = String(body.title).trim().slice(0, 120) || "제목 없는 보드";
        await env.DB.prepare("UPDATE boards SET title = ? WHERE id = ?").bind(t, boardId).run();
      }
      if (body.share !== undefined) {
        if (!acc.isOwner) throw new HttpError(403, "공유 설정은 소유자만 바꿀 수 있어요");
        if (!["private", "view", "edit"].includes(body.share)) throw new HttpError(400, "bad share mode");
        await env.DB.prepare("UPDATE boards SET share = ? WHERE id = ?").bind(body.share, boardId).run();
      }
      return json({ ok: true });
    }

    if (sub === "" && method === "DELETE") {
      if (!acc.isOwner) throw new HttpError(403, "소유자만 삭제할 수 있어요");
      await roomStub(env, boardId).fetch("https://room/delete", { method: "POST" });
      await env.DB.batch([
        env.DB.prepare("DELETE FROM assets WHERE board_id = ?").bind(boardId),
        env.DB.prepare("DELETE FROM board_visits WHERE board_id = ?").bind(boardId),
        env.DB.prepare("DELETE FROM boards WHERE id = ?").bind(boardId),
      ]);
      return json({ ok: true });
    }

    if (sub === "/duplicate" && method === "POST") {
      const me = await requireUser(req, env);
      const res = await roomStub(env, boardId).fetch("https://room/snapshot", {
        headers: { "x-board-id": boardId },
      });
      const elements = ((await res.json()) as El[]).filter((e) => !e.isDeleted);
      const id = randomId(9);
      const now = Date.now();
      // image assets are copied so the duplicate keeps working independently of the original
      const remapped = elements.map((e) => (e.assetId ? { ...e, assetId: `${e.assetId}_${id}` } : e));
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO boards (id, owner_id, title, data, thumbnail, share, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'private', ?, ?)`,
        ).bind(id, me.id, `${b.title} (사본)`, JSON.stringify(remapped), b.thumbnail, now, now),
        env.DB.prepare(
          `INSERT INTO assets (id, board_id, mime, data, created_at)
           SELECT id || '_' || ?, ?, mime, data, created_at FROM assets WHERE board_id = ?`,
        ).bind(id, id, boardId),
      ]);
      return json({ id }, 201);
    }

    if (sub === "/thumbnail" && method === "PUT") {
      if (!acc.canEdit) throw new HttpError(403, "편집 권한이 없어요");
      const body = await readJson<{ thumbnail?: string }>(req, 400_000);
      const t = body.thumbnail;
      if (typeof t !== "string" || !t.startsWith("data:image/")) throw new HttpError(400, "bad thumbnail");
      await env.DB.prepare("UPDATE boards SET thumbnail = ? WHERE id = ?").bind(t, boardId).run();
      return json({ ok: true });
    }

    if (sub === "/assets" && method === "POST") {
      if (!acc.canEdit) throw new HttpError(403, "편집 권한이 없어요");
      const mime = req.headers.get("content-type") || "";
      if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(mime)) throw new HttpError(415, "이미지 파일만 올릴 수 있어요");
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_ASSET_BYTES) throw new HttpError(413, "이미지가 너무 커요 (최대 약 1.9MB)");
      const id = randomId(12);
      await env.DB.prepare("INSERT INTO assets (id, board_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id, boardId, mime, buf, Date.now())
        .run();
      return json({ id }, 201);
    }

    if (sub === "/ws") {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") throw new HttpError(426, "Expected websocket");
      const headers = new Headers(req.headers);
      headers.set("x-board-id", boardId);
      headers.set(
        "x-user",
        encodeURIComponent(
          JSON.stringify({
            uid: user?.id ?? `anon-${randomId(4)}`,
            name: user?.name ?? "익명",
            avatar: user?.avatar ?? null,
            canEdit: acc.canEdit,
          }),
        ),
      );
      return roomStub(env, boardId).fetch(new Request("https://room/ws", { headers }));
    }
  }

  const a = path.match(/^\/api\/assets\/([A-Za-z0-9_-]+)$/);
  if (a && method === "GET") {
    const row = await env.DB.prepare(
      `SELECT a.mime, a.data, b.owner_id, b.share, b.id, b.title, b.thumbnail, b.updated_at
         FROM assets a JOIN boards b ON b.id = a.board_id WHERE a.id = ?`,
    )
      .bind(a[1])
      .first<BoardRow & { mime: string; data: ArrayBuffer | number[] }>();
    if (!row) throw new HttpError(404, "Not found");
    const user = row.share === "private" ? await getUser(req, env) : null;
    if (row.share === "private" && !access(row, user).canView) throw new HttpError(403, "Forbidden");
    const body = row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data);
    return new Response(body, {
      headers: {
        "content-type": row.mime,
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  }

  throw new HttpError(404, "Not found");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/auth/")) return await handleAuth(req, env, url);
      if (url.pathname.startsWith("/api/")) return await handleApi(req, env, url);
      return env.ASSETS.fetch(req);
    } catch (e) {
      if (e instanceof HttpError) {
        if (url.pathname.startsWith("/auth/")) {
          return new Response(`<!doctype html><meta charset="utf-8"><title>로그인 오류</title>
<body style="font-family:system-ui;padding:40px"><h2>로그인 오류</h2><p>${escapeHtml(e.message)}</p><a href="/">처음으로</a>`, {
            status: e.status,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        return json({ error: e.message }, e.status);
      }
      console.error(e);
      return json({ error: "Internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
