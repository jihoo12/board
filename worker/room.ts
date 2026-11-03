import { DurableObject } from "cloudflare:workers";
import { PEER_COLORS, shouldReplace, type ClientMsg, type El, type Peer, type ServerMsg } from "../shared/types";
import type { Env } from "./util";

const FLUSH_DELAY_MS = 2000;
const MAX_ELEMENTS_PER_MSG = 2000;

function colorFor(uid: string) {
  let h = 0;
  for (const c of uid) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PEER_COLORS[h % PEER_COLORS.length];
}

/**
 * One instance per board. Holds the authoritative element state, relays
 * live changes between connected clients (WebSocket hibernation API) and
 * periodically persists the board into D1.
 *
 * Elements are mirrored into this object's own storage on every change so
 * nothing is lost if the object is evicted before the D1 flush runs.
 */
export class BoardRoom extends DurableObject<Env> {
  private elements: Map<string, El> | null = null;
  private loading: Promise<void> | null = null;

  private async boardId(): Promise<string | null> {
    return (await this.ctx.storage.get<string>("boardId")) ?? null;
  }

  private load(): Promise<void> {
    if (this.elements) return Promise.resolve();
    if (!this.loading) {
      this.loading = (async () => {
        const hydrated = await this.ctx.storage.get<boolean>("hydrated");
        const map = new Map<string, El>();
        if (hydrated) {
          const stored = await this.ctx.storage.list<El>({ prefix: "el:" });
          for (const [k, v] of stored) map.set(k.slice(3), v);
        } else {
          const id = await this.boardId();
          if (id) {
            const row = await this.env.DB.prepare("SELECT data FROM boards WHERE id = ?").bind(id).first<{ data: string }>();
            const els: El[] = row ? JSON.parse(row.data) : [];
            for (const e of els) map.set(e.id, e);
            await this.putElements(els);
            await this.ctx.storage.put("hydrated", true);
          }
        }
        this.elements = map;
      })().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  private async putElements(els: El[]) {
    for (let i = 0; i < els.length; i += 128) {
      const chunk: Record<string, El> = {};
      for (const e of els.slice(i, i + 128)) chunk[`el:${e.id}`] = e;
      await this.ctx.storage.put(chunk);
    }
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closed */
    }
  }

  private broadcast(msg: ServerMsg, except?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch {
        /* ignore */
      }
    }
  }

  private peers(): Peer[] {
    return this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment() as Peer).filter(Boolean);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      const boardId = req.headers.get("x-board-id");
      if (boardId && !(await this.boardId())) await this.ctx.storage.put("boardId", boardId);
      const info = JSON.parse(decodeURIComponent(req.headers.get("x-user") || "{}"));
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      const peer: Peer = {
        cid: crypto.randomUUID().slice(0, 8),
        uid: info.uid,
        name: info.name,
        avatar: info.avatar,
        canEdit: !!info.canEdit,
        color: colorFor(info.uid),
      };
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment(peer);
      await this.load();
      this.send(server, {
        t: "init",
        elements: [...this.elements!.values()],
        self: peer,
        peers: this.peers().filter((p) => p.cid !== peer.cid),
      });
      this.broadcast({ t: "join", peer }, server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/snapshot") {
      const boardId = req.headers.get("x-board-id");
      if (boardId && !(await this.boardId())) await this.ctx.storage.put("boardId", boardId);
      await this.load();
      return Response.json([...this.elements!.values()]);
    }

    if (url.pathname === "/delete") {
      this.broadcast({ t: "deleted" });
      for (const ws of this.ctx.getWebSockets()) ws.close(4004, "board deleted");
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.elements = new Map();
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const peer = ws.deserializeAttachment() as Peer;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }

    switch (msg.t) {
      case "ping":
        this.send(ws, { t: "pong" });
        return;
      case "cursor":
        this.broadcast({ t: "cursor", cid: peer.cid, x: msg.x, y: msg.y }, ws);
        return;
      case "laser":
        this.broadcast({ t: "laser", cid: peer.cid, x: msg.x, y: msg.y, start: msg.start }, ws);
        return;
      case "selection":
        this.broadcast({ t: "selection", cid: peer.cid, ids: (msg.ids || []).slice(0, 500) }, ws);
        return;
      case "upsert": {
        if (!peer.canEdit) {
          this.send(ws, { t: "error", message: "읽기 전용 보드예요" });
          return;
        }
        await this.load();
        const els = Array.isArray(msg.elements) ? msg.elements.slice(0, MAX_ELEMENTS_PER_MSG) : [];
        const accepted: El[] = [];
        const rejected: El[] = [];
        for (const e of els) {
          if (!e || typeof e.id !== "string" || typeof e.type !== "string" || typeof e.version !== "number") continue;
          const cur = this.elements!.get(e.id);
          if (shouldReplace(cur, e)) {
            this.elements!.set(e.id, e);
            accepted.push(e);
          } else if (cur) {
            rejected.push(cur);
          }
        }
        if (accepted.length) {
          await this.putElements(accepted);
          this.broadcast({ t: "upsert", elements: accepted, from: peer.cid }, ws);
          if ((await this.ctx.storage.getAlarm()) == null) {
            await this.ctx.storage.setAlarm(Date.now() + FLUSH_DELAY_MS);
          }
        }
        // tell the sender the newer state it lost against
        if (rejected.length) this.send(ws, { t: "upsert", elements: rejected });
        return;
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    const peer = ws.deserializeAttachment() as Peer | null;
    if (peer) this.broadcast({ t: "leave", cid: peer.cid }, ws);
    try {
      ws.close(1000, "bye");
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket) {
    const peer = ws.deserializeAttachment() as Peer | null;
    if (peer) this.broadcast({ t: "leave", cid: peer.cid }, ws);
  }

  /** Persist the current board into D1. */
  async alarm() {
    const id = await this.boardId();
    if (!id) return;
    await this.load();
    const live = [...this.elements!.values()].filter((e) => !e.isDeleted);
    await this.env.DB.prepare("UPDATE boards SET data = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(live), Date.now(), id)
      .run();
  }
}
